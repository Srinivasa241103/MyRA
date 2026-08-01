export const DEFAULT_ALERT_THRESHOLDS = Object.freeze({
  half: 50,
  attention: 80,
  critical: 95,
});

const ALERT_META = Object.freeze({
  half: {
    key: "half",
    name: "HEADS UP",
    label: "Heads up",
    color: "#2563eb",
    background: "#eff6ff",
  },
  attention: {
    key: "attention",
    name: "ATTENTION",
    label: "Needs attention",
    color: "#d97706",
    background: "#fffbeb",
  },
  critical: {
    key: "critical",
    name: "CRITICAL",
    label: "Critical",
    color: "#dc2626",
    background: "#fef2f2",
  },
});

function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function getAlertLevels(
  percentUsed: number,
  thresholds = DEFAULT_ALERT_THRESHOLDS,
) {
  return (["half", "attention", "critical"] as const)
    .filter((key) => percentUsed >= Number(thresholds[key]))
    .map((key) => ({
      ...ALERT_META[key],
      threshold: Number(thresholds[key]),
    }));
}

export function getAlertLevel(
  percentUsed: number,
  thresholds = DEFAULT_ALERT_THRESHOLDS,
) {
  return getAlertLevels(percentUsed, thresholds).at(-1) ?? null;
}

function formatInr(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function recommendation(levelKey: string, percentUsed: number) {
  if (levelKey === "critical") {
    return percentUsed >= 100
      ? "Tracked usage is over this budget. Review recent activity, use a lower-cost model, or update the budget in MyRA settings."
      : "You are close to this budget. Review recent activity, use a lower-cost model, or update the budget in MyRA settings.";
  }
  if (levelKey === "attention") {
    return "Usage is getting close to the limit. Review recent activity and keep an eye on the remaining budget.";
  }
  return "This is an early heads-up. No immediate action is required, but you may want to review recent usage in MyRA settings.";
}

export function buildCredsAlertEmail({
  service,
  used,
  budget,
  periodStart,
  periodEnd,
  level,
  thresholds = DEFAULT_ALERT_THRESHOLDS,
}) {
  if (!budget || budget <= 0) return null;

  const percent = (used / budget) * 100;
  const selectedLevel = level ?? getAlertLevel(percent, thresholds);
  if (!selectedLevel) return null;

  const safeService = escapeHtml(service);
  const remaining = Math.max(budget - used, 0);
  const now = new Date();
  const start = new Date(
    periodStart ?? new Date(now.getFullYear(), now.getMonth(), 1),
  );
  const end = new Date(
    periodEnd ?? new Date(now.getFullYear(), now.getMonth() + 1, 0),
  );
  const totalDays = Math.max(
    Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1,
    1,
  );
  const elapsedDays = Math.min(
    Math.max(
      Math.floor((now.getTime() - start.getTime()) / 86_400_000) + 1,
      1,
    ),
    totalDays,
  );
  const dailyAverage = used / elapsedDays;
  const progressWidth = Math.min(percent, 100);
  const subject = `[${selectedLevel.name}] ${service} usage is ${percent.toFixed(1)}% of your monthly budget`;

  const html = `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f0ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#292524;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;background:#f3f0ea;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e7e0d5;border-radius:18px;overflow:hidden;box-shadow:0 12px 32px rgba(67,48,34,0.10);">
        <tr>
          <td style="padding:28px 32px;background-color:${selectedLevel.color};background-image:linear-gradient(135deg,${selectedLevel.color},#292524);color:#ffffff;">
            <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;opacity:.85;">MyRA API budget alert</div>
            <div style="margin-top:14px;font-size:26px;font-weight:750;line-height:1.25;">${safeService} needs your attention</div>
            <div style="margin-top:8px;font-size:15px;line-height:1.5;opacity:.9;">Tracked usage for the current calendar month crossed your ${selectedLevel.threshold}% ${escapeHtml(selectedLevel.label.toLowerCase())} threshold.</div>
          </td>
        </tr>
        <tr>
          <td style="padding:30px 32px 12px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-size:14px;color:#78716c;">Tracked this month</td>
                <td align="right" style="font-size:14px;color:#78716c;">Monthly budget</td>
              </tr>
              <tr>
                <td style="padding-top:6px;font-size:28px;font-weight:750;color:${selectedLevel.color};">${formatInr(used)}</td>
                <td align="right" style="padding-top:6px;font-size:18px;font-weight:650;">${formatInr(budget)}</td>
              </tr>
            </table>
            <div style="margin-top:18px;height:12px;background:#e7e5e4;border-radius:999px;overflow:hidden;">
              <div style="width:${progressWidth}%;height:12px;background:${selectedLevel.color};border-radius:999px;"></div>
            </div>
            <div style="margin-top:8px;text-align:right;font-size:13px;font-weight:650;color:${selectedLevel.color};">${percent.toFixed(1)}% used</div>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 32px 26px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="48%" style="padding:16px;background:${selectedLevel.background};border-radius:12px;">
                  <div style="font-size:11px;color:#78716c;text-transform:uppercase;letter-spacing:.7px;">Remaining</div>
                  <div style="margin-top:5px;font-size:19px;font-weight:700;">${formatInr(remaining)}</div>
                </td>
                <td width="4%"></td>
                <td width="48%" style="padding:16px;background:${selectedLevel.background};border-radius:12px;">
                  <div style="font-size:11px;color:#78716c;text-transform:uppercase;letter-spacing:.7px;">Days elapsed</div>
                  <div style="margin-top:5px;font-size:19px;font-weight:700;">${elapsedDays} of ${totalDays}</div>
                </td>
              </tr>
              <tr><td colspan="3" height="12"></td></tr>
              <tr>
                <td width="48%" style="padding:16px;background:#fafaf9;border-radius:12px;">
                  <div style="font-size:11px;color:#78716c;text-transform:uppercase;letter-spacing:.7px;">Daily average</div>
                  <div style="margin-top:5px;font-size:19px;font-weight:700;">${formatInr(dailyAverage)}</div>
                </td>
                <td width="4%"></td>
                <td width="48%" style="padding:16px;background:#fafaf9;border-radius:12px;">
                  <div style="font-size:11px;color:#78716c;text-transform:uppercase;letter-spacing:.7px;">Alert threshold</div>
                  <div style="margin-top:5px;font-size:19px;font-weight:700;color:${selectedLevel.color};">${selectedLevel.threshold}%</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 30px;">
            <div style="padding:16px 18px;border-left:4px solid ${selectedLevel.color};border-radius:0 10px 10px 0;background:${selectedLevel.background};font-size:14px;line-height:1.6;color:#44403c;">
              <strong style="display:block;margin-bottom:3px;color:${selectedLevel.color};">What to do next</strong>
              ${recommendation(selectedLevel.key, percent)}
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #e7e5e4;background:#fafaf9;font-size:12px;line-height:1.6;color:#78716c;">
            Budget period: ${escapeHtml(start.toLocaleDateString("en-IN"))} – ${escapeHtml(end.toLocaleDateString("en-IN"))}<br />
            This alert was sent automatically using the thresholds in your MyRA settings.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  return { subject, html, level: selectedLevel };
}
