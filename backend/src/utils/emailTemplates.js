export const ALERT_LEVELS = {
  GENERAL: {
    threshold: 50,
    name: "GENERAL",
    color: "#2563eb",
    bg: "#eff6ff",
    emoji: "ℹ️",
    prefix: "Heads up",
  },
  URGENT: {
    threshold: 75,
    name: "URGENT",
    color: "#d97706",
    bg: "#fffbeb",
    emoji: "⚠️",
    prefix: "Urgent",
  },
  CRITICAL: {
    threshold: 90,
    name: "CRITICAL",
    color: "#dc2626",
    bg: "#fef2f2",
    emoji: "🚨",
    prefix: "Critical",
  },
};

export function getAlertLevel(percentUsed) {
  if (percentUsed >= ALERT_LEVELS.CRITICAL.threshold)
    return ALERT_LEVELS.CRITICAL;
  if (percentUsed >= ALERT_LEVELS.URGENT.threshold) return ALERT_LEVELS.URGENT;
  if (percentUsed >= ALERT_LEVELS.GENERAL.threshold)
    return ALERT_LEVELS.GENERAL;
  return null;
}

export function buildCredsAlertEmail({
  service,
  used,
  budget,
  unit = "$",
  periodStart,
  periodEnd,
}) {
  const percent = (used / budget) * 100;
  const level = getAlertLevel(percent);
  if (!level) return null; // below 50% — no alert needed

  const remaining = Math.max(budget - used, 0);
  const now = new Date();
  const start = periodStart || new Date(now.getFullYear(), now.getMonth(), 1);
  const end = periodEnd || new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const totalDays = Math.ceil((end - start) / 86400000);
  const daysElapsed = Math.max(Math.ceil((now - start) / 86400000), 1);
  const daysLeft = Math.max(totalDays - daysElapsed, 0);
  const dailyAverage = used / daysElapsed;
  const projected = dailyAverage * totalDays;
  const projectedPct = (projected / budget) * 100;

  const subject = `[${level.name}] ${service} usage at ${percent.toFixed(
    1
  )}% of monthly budget`;

  const fmt = (n, digits = 2) =>
    `${unit === "$" ? "$" : ""}${n.toFixed(digits)}${
      unit !== "$" ? ` ${unit}` : ""
    }`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
 
          <!-- Header -->
          <tr>
            <td style="background:${level.color};padding:24px 32px;">
              <div style="color:#ffffff;font-size:13px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;opacity:0.9;">
                ${level.emoji} ${level.prefix} Alert
              </div>
              <div style="color:#ffffff;font-size:22px;font-weight:700;margin-top:8px;line-height:1.3;">
                ${service} has used ${percent.toFixed(1)}% of its monthly budget
              </div>
            </td>
          </tr>
 
          <!-- Usage bar -->
          <tr>
            <td style="padding:28px 32px 8px 32px;">
              <div style="font-size:14px;color:#6b7280;margin-bottom:8px;">Current usage</div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;">
                <span style="font-size:28px;font-weight:700;color:${
                  level.color
                };">${fmt(used)}</span>
                <span style="font-size:14px;color:#6b7280;">of ${fmt(
                  budget
                )}</span>
              </div>
              <div style="background:#e5e7eb;border-radius:999px;height:10px;overflow:hidden;">
                <div style="background:${
                  level.color
                };height:100%;width:${Math.min(
    percent,
    100
  )}%;border-radius:999px;"></div>
              </div>
            </td>
          </tr>
 
          <!-- Stats grid -->
          <tr>
            <td style="padding:24px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%" style="padding:12px;background:${
                    level.bg
                  };border-radius:8px;">
                    <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Remaining</div>
                    <div style="font-size:18px;font-weight:600;color:#111827;margin-top:4px;">${fmt(
                      remaining
                    )}</div>
                  </td>
                  <td width="12"></td>
                  <td width="50%" style="padding:12px;background:${
                    level.bg
                  };border-radius:8px;">
                    <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Days left in period</div>
                    <div style="font-size:18px;font-weight:600;color:#111827;margin-top:4px;">${daysLeft} days</div>
                  </td>
                </tr>
                <tr><td colspan="3" height="12"></td></tr>
                <tr>
                  <td width="50%" style="padding:12px;background:#f9fafb;border-radius:8px;">
                    <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Daily average</div>
                    <div style="font-size:18px;font-weight:600;color:#111827;margin-top:4px;">${fmt(
                      dailyAverage
                    )}</div>
                  </td>
                  <td width="12"></td>
                  <td width="50%" style="padding:12px;background:#f9fafb;border-radius:8px;">
                    <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Projected month-end</div>
                    <div style="font-size:18px;font-weight:600;color:${
                      projectedPct > 100 ? "#dc2626" : "#111827"
                    };margin-top:4px;">
                      ${fmt(
                        projected
                      )} <span style="font-size:13px;font-weight:500;color:#6b7280;">(${projectedPct.toFixed(
    0
  )}%)</span>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
 
          <!-- Recommendation -->
          <tr>
            <td style="padding:8px 32px 28px 32px;">
              <div style="border-left:3px solid ${
                level.color
              };padding:12px 16px;background:${
    level.bg
  };border-radius:0 8px 8px 0;">
                <div style="font-size:13px;font-weight:600;color:${
                  level.color
                };text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">
                  Recommendation
                </div>
                <div style="font-size:14px;color:#374151;line-height:1.6;">
                  ${_getRecommendation(level.name, projectedPct)}
                </div>
              </div>
            </td>
          </tr>
 
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <div style="font-size:12px;color:#9ca3af;line-height:1.5;">
                Period: ${start.toDateString()} → ${end.toDateString()}<br/>
                Sent automatically by your Personal AI Assistant.
              </div>
            </td>
          </tr>
 
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

  return { subject, html, level };
}

function _getRecommendation(levelName, projectedPct) {
  if (levelName === "CRITICAL") {
    return "You are very close to exhausting your monthly budget. Consider pausing non-essential API calls, switching to a cheaper model, or increasing the budget for this service.";
  }
  if (levelName === "URGENT") {
    return projectedPct > 100
      ? `At the current rate, you are projected to exceed your budget by month end. Consider reducing usage or batching requests.`
      : "Usage is trending high. Review which features are consuming the most credits and optimize where possible.";
  }
  return "You have crossed the halfway mark for this period. No action needed yet — this is just a heads-up to keep an eye on usage.";
}
