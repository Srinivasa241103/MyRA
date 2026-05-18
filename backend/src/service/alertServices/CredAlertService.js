// services/credsAlertService.js
import Mailer from "../../utils/mailSender.js";
import {
  buildCredsAlertEmail,
  getAlertLevel,
} from "../../utils/emailTemplates.js";

/**
 * Tracks which alert tiers have already been sent for which service
 * in the current billing period, so we don't spam the inbox.
 *
 * In-memory for now. For production, persist this in PostgreSQL —
 * a small table like:
 *   creds_alert_log(service TEXT, level TEXT, period_key TEXT, sent_at TIMESTAMP)
 *   PRIMARY KEY (service, level, period_key)
 *
 * Then replace _hasBeenSent / _markSent with DB queries.
 */
const sentAlerts = new Map(); // key: `${service}:${level}:${YYYY-MM}`
const mailer = new Mailer();

function _periodKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}`;
}

function _alertKey(service, levelName, date = new Date()) {
  return `${service}:${levelName}:${_periodKey(date)}`;
}

function _hasBeenSent(service, levelName) {
  return sentAlerts.has(_alertKey(service, levelName));
}

function _markSent(service, levelName) {
  sentAlerts.set(_alertKey(service, levelName), new Date().toISOString());
}

/**
 * Check usage against the budget and send an alert email if a new
 * threshold has been crossed.
 *
 * Idempotent: calling repeatedly with the same usage will only send once
 * per (service, level, month). Calling again after crossing the next
 * threshold sends a new alert.
 *
 * @param {Object} params
 * @param {string} params.service       Service name (e.g. "Anthropic Claude")
 * @param {number} params.used          Amount consumed this month
 * @param {number} params.budget        Monthly budget
 * @param {string} [params.unit='$']    Display unit
 * @param {string} [params.recipient]   Override recipient email
 * @returns {Promise<{ sent: boolean, level?: string, reason?: string }>}
 */
export async function checkAndAlert({
  service,
  used,
  budget,
  unit = "$",
  recipient,
}) {
  if (!service || budget <= 0) {
    return { sent: false, reason: "invalid input" };
  }

  const percent = (used / budget) * 100;
  const level = getAlertLevel(percent);

  if (!level) {
    return {
      sent: false,
      reason: `usage at ${percent.toFixed(1)}% — below alert thresholds`,
    };
  }

  if (_hasBeenSent(service, level.name)) {
    return {
      sent: false,
      level: level.name,
      reason: `${level.name} alert already sent for ${service} this period`,
    };
  }

  const email = buildCredsAlertEmail({ service, used, budget, unit });
  if (!email) return { sent: false, reason: "no email generated" };

  const to =
    recipient || process.env.MAIL_ALERT_RECIPIENT || process.env.MAIL_USER;
  const result = await mailer.sendMail({
    to,
    subject: email.subject,
    html: email.html,
  });

  if (result.success) {
    _markSent(service, level.name);
    return { sent: true, level: level.name };
  }

  return { sent: false, level: level.name, reason: result.error };
}

/**
 * Reset all sent-alert tracking. Call this on the 1st of every month
 * via cron so alerts can fire again in the new billing period.
 *
 * If you persist to Postgres instead, this becomes a no-op (the
 * period_key in the DB naturally handles month rollover).
 */
export function resetAlertHistory() {
  const currentPeriod = _periodKey();
  for (const key of sentAlerts.keys()) {
    if (!key.endsWith(currentPeriod)) sentAlerts.delete(key);
  }
  console.log("[CredsAlert] Reset alert history for past periods");
}

/** Diagnostic: see which alerts have fired this period */
export function getAlertHistory() {
  return Object.fromEntries(sentAlerts);
}
