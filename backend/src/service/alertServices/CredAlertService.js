import Mailer from "../../utils/mailSender.js";
import { buildCredsAlertEmail } from "../../utils/emailTemplates.js";

const mailer = new Mailer();

export async function sendBudgetAlert({
  service,
  used,
  budget,
  recipient,
  level,
  periodStart,
  periodEnd,
}) {
  if (!service || !recipient || !level || budget <= 0) {
    return { sent: false, reason: "invalid alert input" };
  }

  const email = buildCredsAlertEmail({
    service,
    used,
    budget,
    level,
    periodStart,
    periodEnd,
  });

  if (!email) return { sent: false, reason: "no email generated" };

  const result = await mailer.sendMail({
    to: recipient,
    subject: email.subject,
    html: email.html,
  });

  return result.success
    ? { sent: true, level: level.name, messageId: result.messageId }
    : { sent: false, level: level.name, reason: result.error };
}
