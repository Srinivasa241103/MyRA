import { useState, useEffect, useRef } from "react";
import { statsApi } from "../api/stats";

const EMPTY_STATS = {
  emails: [],
  tokens: [],
  reminders: [],
  cost: [],
  sessions: [],
  calEvents: [],
};

const MIN_LOADING_MS = 520;

const CHART_PALETTE = [
  "var(--color-accent)",
  "var(--color-accent-400)",
  "var(--color-accent-2)",
  "var(--color-info)",
  "var(--color-warm)",
  "var(--color-border-strong)",
  "var(--color-accent-300)",
  "var(--color-accent-2-300)",
];

const RANGE_LABELS = {
  "7d": "last 7 days",
  "14d": "last 14 days",
  "30d": "last 30 days",
  "90d": "last 90 days",
};

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const sumValues = (values) => values.reduce((sum, value) => sum + toNumber(value), 0);
const getPaletteColor = (index) => CHART_PALETTE[index % CHART_PALETTE.length];

export default function StatsScreen() {
  const [range, setRange] = useState("14d");
  const [data, setData] = useState(EMPTY_STATS);
  const [isLoading, setIsLoading] = useState(true);
  const [animationKey, setAnimationKey] = useState(0);
  const fetchSeqRef = useRef(0);

  useEffect(() => {
    const fetchSeq = fetchSeqRef.current + 1;
    fetchSeqRef.current = fetchSeq;
    const startedAt = performance.now();
    let timeoutId;
    let cancelled = false;

    statsApi
      .getAll(range)
      .then((nextData) => {
        if (cancelled || fetchSeqRef.current !== fetchSeq) return;
        const elapsed = performance.now() - startedAt;
        const remainingDelay = Math.max(0, MIN_LOADING_MS - elapsed);

        timeoutId = window.setTimeout(() => {
          if (cancelled || fetchSeqRef.current !== fetchSeq) return;
          setData(nextData);
          setAnimationKey((key) => key + 1);
          setIsLoading(false);
        }, remainingDelay);
      })
      .catch(() => {
        if (cancelled || fetchSeqRef.current !== fetchSeq) return;
        timeoutId = window.setTimeout(() => {
          if (cancelled || fetchSeqRef.current !== fetchSeq) return;
          setData(EMPTY_STATS);
          setAnimationKey((key) => key + 1);
          setIsLoading(false);
        }, MIN_LOADING_MS);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [range]);

  const {
    emails: EMAILS_14D,
    tokens: TOKENS,
    reminders: REMINDERS_7D,
    cost: COST_30D,
    sessions: CHAT_SESSIONS,
    calEvents: CAL_EVENTS,
  } = data;

  const tokenSegments = TOKENS.map((token, index) => ({
    ...token,
    value: toNumber(token.value),
    color: getPaletteColor(index),
  }));

  const hasEmails = EMAILS_14D.length > 0;
  const hasTokens = tokenSegments.some((token) => token.value > 0);
  const hasReminders = REMINDERS_7D.length > 0;
  const hasCost = COST_30D.length > 0;
  const hasSessions = CHAT_SESSIONS.length > 0;
  const hasCalEvents = CAL_EVENTS.length > 0;
  const buildDayLabels = (values) => values.map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (values.length - 1 - i));
    return d.getDate();
  });
  const emailLabels = buildDayLabels(EMAILS_14D);
  const sessionLabels = buildDayLabels(CHAT_SESSIONS);
  const calendarLabels = buildDayLabels(CAL_EVENTS);

  const totalTokens = tokenSegments.reduce((s, t) => s + t.value, 0);
  const totalCost = COST_30D.reduce((s, c) => s + toNumber(c.spend), 0);
  const remindersSet = REMINDERS_7D.reduce((s, r) => s + toNumber(r.set), 0);
  const remindersDone = REMINDERS_7D.reduce((s, r) => s + toNumber(r.done), 0);
  const reminderCompletion = remindersSet > 0
    ? Math.round((remindersDone / remindersSet) * 100)
    : 0;
  const rangeLabel = RANGE_LABELS[range] ?? RANGE_LABELS["14d"];
  const chartKey = `${range}-${animationKey}`;

  const changeRange = (nextRange) => {
    if (nextRange !== range) {
      setIsLoading(true);
      setRange(nextRange);
    }
  };

  return (
    <div className="myra-page-inner" style={{ paddingTop: 32, paddingBottom: 48 }} aria-busy={isLoading}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 className="display lg" style={{ marginBottom: 4 }}>Usage</h1>
          <p className="muted">{isLoading ? "Refreshing usage..." : `${rangeLabel} | all connected services`}</p>
        </div>
        <div className="myra-pills">
          {["7d", "14d", "30d", "90d"].map((r) => (
            <button
              key={r}
              className={range === r ? "active" : ""}
              onClick={() => changeRange(r)}
              aria-pressed={range === r}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="myra-stats-kpi-scroll">
        {isLoading ? (
          <>
            <KpiLoadingTile />
            <KpiLoadingTile />
            <KpiLoadingTile />
            <KpiLoadingTile />
          </>
        ) : (
          <>
            {hasEmails ? (
              <KpiTile
                label="Emails received"
                value={sumValues(EMAILS_14D)}
                trend={EMAILS_14D.length >= 2 ? EMAILS_14D : null}
                accentColor={getPaletteColor(0)}
              />
            ) : (
              <KpiEmptyTile label="Emails received" />
            )}
            {hasTokens ? (
              <KpiTile
                label="Tokens used"
                value={(totalTokens / 1000).toFixed(0) + "K"}
                accentColor={getPaletteColor(1)}
              />
            ) : (
              <KpiEmptyTile label="Tokens used" />
            )}
            {hasReminders ? (
              <KpiTile
                label="Reminders"
                value={`${remindersDone}/${remindersSet}`}
                delta={`${reminderCompletion}% complete`}
                up
                trend={REMINDERS_7D.map((r) => toNumber(r.done))}
                accentColor={getPaletteColor(2)}
              />
            ) : (
              <KpiEmptyTile label="Reminders" />
            )}
            {hasCost ? (
              <KpiTile
                label="Spend"
                value={"₹" + totalCost.toFixed(2)}
                accentColor={getPaletteColor(3)}
              />
            ) : (
              <KpiEmptyTile label="Spend" />
            )}
          </>
        )}
      </div>

      {/* Big charts */}
      <div className="myra-stats-charts-scroll" style={{ marginBottom: 16 }}>
        <div className="myra-card myra-stats-reveal">
          <div className="myra-card-header">
            <div>
              <h3>Emails received</h3>
              <span className="muted" style={{ fontSize: 12 }}>Per day · {rangeLabel}</span>
            </div>
            {!isLoading && hasEmails && (
              <span className="myra-badge accent">
                avg {Math.round(sumValues(EMAILS_14D) / EMAILS_14D.length)}/day
              </span>
            )}
          </div>
          {isLoading ? (
            <ChartLoadingState variant="bars" />
          ) : hasEmails ? (
            <BarChart
              key={`email-bars-${chartKey}`}
              values={EMAILS_14D}
              labels={emailLabels}
              h={180}
              color="var(--amber)"
            />
          ) : (
            <NoDataState />
          )}
        </div>

        <div className="myra-card myra-stats-reveal" style={{ animationDelay: "70ms" }}>
          <div className="myra-card-header">
            <h3>Tokens by model</h3>
            <span className="muted" style={{ fontSize: 12 }}>{rangeLabel}</span>
          </div>
          {isLoading ? (
            <ChartLoadingState variant="donut" />
          ) : hasTokens ? (
            <div className="myra-donut-legend" key={`token-donut-${chartKey}`}>
              <Donut data={tokenSegments} centerLabel="TOTAL" centerValue={(totalTokens / 1e6).toFixed(2) + "M"} size={140} />
              <div className="myra-donut-legend-list">
                {tokenSegments.map((t, index) => (
                  <div key={`${t.name}-${index}`} className="myra-stats-legend-row">
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, color: "var(--text-2)" }}>{t.name}</span>
                    <span className="muted mono">{(t.value / 1e3).toFixed(0)}K</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <NoDataState />
          )}
        </div>
      </div>

      {/* Bottom charts row */}
      <div className="myra-stats-cards-scroll" style={{ marginBottom: 16 }}>
        {/* Reminders */}
        <div className="myra-card myra-stats-reveal" style={{ animationDelay: "120ms" }}>
          <div className="myra-card-header">
            <h3>Reminders set vs finished</h3>
            {!isLoading && hasReminders && (
              <span className="myra-badge success">{reminderCompletion}%</span>
            )}
          </div>
          {isLoading ? (
            <ChartLoadingState variant="grouped" />
          ) : hasReminders ? (
            <>
              <GroupedBars
                key={`reminders-${chartKey}`}
                groups={REMINDERS_7D}
                keys={["set", "done"]}
                colors={["var(--color-accent-2)", "var(--color-accent)"]}
                h={170}
              />
              <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 11 }}>
                <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--color-accent-2)", marginRight: 6, borderRadius: 2 }} />Set</span>
                <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--color-accent)", marginRight: 6, borderRadius: 2 }} />Done</span>
              </div>
            </>
          ) : (
            <NoDataState />
          )}
        </div>

        {/* Calendar events */}
        <div className="myra-card myra-stats-reveal" style={{ animationDelay: "170ms" }}>
          <div className="myra-card-header">
            <h3>Calendar events</h3>
            <span className="muted" style={{ fontSize: 12 }}>handled by agent</span>
          </div>
          {isLoading ? (
            <ChartLoadingState variant="line" compact />
          ) : hasCalEvents ? (
            <>
              <div className="myra-label" style={{ marginBottom: 6 }}>Per day</div>
              <LineChart key={`calendar-line-${chartKey}`} values={CAL_EVENTS} labels={calendarLabels} h={90} color="var(--color-info)" />
            </>
          ) : (
            <NoDataState />
          )}
        </div>

        {/* Cost by provider */}
        <div className="myra-card myra-stats-reveal" style={{ animationDelay: "220ms" }}>
          <div className="myra-card-header">
            <h3>Cost by provider</h3>
            <span className="muted" style={{ fontSize: 12 }}>{rangeLabel}</span>
          </div>
          {isLoading ? (
            <ChartLoadingState variant="hbars" compact />
          ) : hasCost ? (
            <>
              {COST_30D.map((c, index) => (
                <HBarRow
                  key={c.provider}
                  label={c.provider}
                  value={toNumber(c.spend)}
                  max={Math.max(1, ...COST_30D.map((x) => toNumber(x.spend)))}
                  fmt={(v) => "₹" + v.toFixed(2)}
                  color={getPaletteColor(index + 3)}
                  delay={index * 80}
                />
              ))}
              <div className="myra-divider" style={{ margin: "12px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span className="muted">Total</span>
                <strong style={{ fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>₹{totalCost.toFixed(2)}</strong>
              </div>
            </>
          ) : (
            <NoDataState />
          )}
        </div>
      </div>

      {/* RAG + sessions */}
      <div className="myra-stats-bottom-scroll">
        <div className="myra-card myra-stats-reveal" style={{ animationDelay: "270ms" }}>
          <div className="myra-card-header">
            <h3>Documents indexed</h3>
          </div>
          {isLoading ? <ChartLoadingState variant="hbars" compact /> : <NoDataState />}
        </div>

        <div className="myra-card myra-stats-reveal" style={{ animationDelay: "320ms" }}>
          <div className="myra-card-header">
            <h3>Chat sessions</h3>
            <span className="muted" style={{ fontSize: 12 }}>Per day</span>
          </div>
          {isLoading ? (
            <ChartLoadingState variant="bars" compact />
          ) : hasSessions ? (
            <BarChart
              key={`sessions-${chartKey}`}
              values={CHAT_SESSIONS}
              labels={sessionLabels}
              h={140}
              colors={CHART_PALETTE.slice(2)}
            />
          ) : (
            <NoDataState />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Chart components (pure SVG) ──────────────────────────────────────────────

function LineChart({ values, w = 520, h = 160, color = "var(--accent)", labels }) {
  const safeValues = values.length ? values.map(toNumber) : [0];
  const pad = { l: 28, r: 8, t: 12, b: 22 };
  const max = Math.max(1, ...safeValues) * 1.1;
  const min = 0;
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const stepX = safeValues.length > 1 ? innerW / (safeValues.length - 1) : 0;
  const ys = safeValues.map((v) => pad.t + (1 - (v - min) / (max - min)) * innerH);
  const xs = safeValues.map((_, i) => safeValues.length > 1 ? pad.l + i * stepX : pad.l + innerW / 2);
  const path = xs.map((x, i) => (i ? "L" : "M") + x.toFixed(1) + "," + ys[i].toFixed(1)).join(" ");
  const area = path + " L " + xs[xs.length - 1].toFixed(1) + "," + (h - pad.b) + " L " + xs[0].toFixed(1) + "," + (h - pad.b) + " Z";
  const ticks = [0, 0.5, 1].map((t) => Math.round(min + t * (max - min)));

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="myra-chart-svg">
      {ticks.map((t, i) => {
        const y = pad.t + (1 - (t - min) / (max - min)) * innerH;
        return (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="var(--border)" strokeDasharray="2 4" />
            <text x={pad.l - 6} y={y + 3} fontSize="10" textAnchor="end" fill="var(--text-muted)">{t}</text>
          </g>
        );
      })}
      <path d={area} fill={color} fillOpacity={0.12} className="myra-chart-area" />
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="myra-chart-line" pathLength="1" />
      {xs.map((x, i) => (
        <circle
          key={i}
          cx={x}
          cy={ys[i]}
          r="3"
          fill={color}
          className="myra-chart-point"
          style={{ animationDelay: `${240 + i * 35}ms` }}
        />
      ))}
      {labels && labels.map((l, i) => (
        <text key={i} x={xs[i]} y={h - 6} fontSize="9" textAnchor="middle" fill="var(--text-muted)">{l}</text>
      ))}
    </svg>
  );
}

function BarChart({ values, w = 520, h = 160, color = "var(--accent)", colors, labels }) {
  const safeValues = values.length ? values.map(toNumber) : [0];
  const pad = { l: 28, r: 8, t: 12, b: 22 };
  const max = Math.max(1, ...safeValues) * 1.15;
  const innerW = w - pad.l - pad.r;
  const bw = innerW / safeValues.length;
  const ticks = [0, 0.5, 1].map((t) => Math.round(t * max));

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="myra-chart-svg">
      {ticks.map((t, i) => {
        const y = pad.t + (1 - t / max) * (h - pad.t - pad.b);
        return (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="var(--border)" strokeDasharray="2 4" />
            <text x={pad.l - 6} y={y + 3} fontSize="10" textAnchor="end" fill="var(--text-muted)">{t}</text>
          </g>
        );
      })}
      {safeValues.map((v, i) => {
        const bh = (v / max) * (h - pad.t - pad.b);
        const x = pad.l + i * bw + bw * 0.18;
        const y = h - pad.b - bh;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={Math.max(3, bw * 0.64)}
            height={Math.max(0, bh)}
            fill={colors?.[i % colors.length] ?? color}
            rx="3"
            className="myra-chart-bar"
            style={{ animationDelay: `${i * 34}ms` }}
          />
        );
      })}
      {labels && labels.map((l, i) => (
        <text key={i} x={pad.l + i * bw + bw / 2} y={h - 6} fontSize="9" textAnchor="middle" fill="var(--text-muted)">{l}</text>
      ))}
    </svg>
  );
}

function GroupedBars({ groups, keys, w = 520, h = 180, colors }) {
  const safeGroups = groups.length ? groups : [{ label: "", ...Object.fromEntries(keys.map((key) => [key, 0])) }];
  const pad = { l: 28, r: 8, t: 12, b: 22 };
  const max = Math.max(1, ...safeGroups.flatMap((g) => keys.map((k) => toNumber(g[k])))) * 1.2;
  const innerW = w - pad.l - pad.r;
  const gW = innerW / safeGroups.length;
  const bw = (gW * 0.7) / keys.length;

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="myra-chart-svg">
      {[0, 0.5, 1].map((t, i) => {
        const y = pad.t + (1 - t) * (h - pad.t - pad.b);
        return <line key={i} x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="var(--border)" strokeDasharray="2 4" />;
      })}
      {safeGroups.map((g, gi) =>
        keys.map((k, ki) => {
          const v = toNumber(g[k]);
          const bh = (v / max) * (h - pad.t - pad.b);
          const x = pad.l + gi * gW + gW * 0.15 + ki * bw;
          const y = h - pad.b - bh;
          return (
            <rect
              key={k + gi}
              x={x}
              y={y}
              width={Math.max(3, bw * 0.85)}
              height={Math.max(0, bh)}
              fill={colors[ki]}
              rx="3"
              className="myra-chart-bar"
              style={{ animationDelay: `${gi * 55 + ki * 25}ms` }}
            />
          );
        })
      )}
      {safeGroups.map((g, gi) => (
        <text key={gi} x={pad.l + gi * gW + gW / 2} y={h - 6} fontSize="10" textAnchor="middle" fill="var(--text-muted)">
          {g.label || g.day}
        </text>
      ))}
    </svg>
  );
}

function Donut({ data, size = 160, thickness = 22, centerLabel, centerValue }) {
  const total = data.reduce((s, d) => s + toNumber(d.value), 0);
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const segments = data.map((d, i) => {
    const previousTotal = data
      .slice(0, i)
      .reduce((sum, item) => sum + toNumber(item.value), 0);
    const dashLength = total > 0 ? (toNumber(d.value) / total) * circ : 0;

    return {
      ...d,
      dashLength,
      dashGap: circ - dashLength,
      dashOffset: total > 0 ? -((previousTotal / total) * circ) : 0,
    };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="myra-donut-svg">
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--bg-2)" strokeWidth={thickness} />
      {segments.map((d, i) => (
        <circle
          key={i}
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={d.color}
          strokeWidth={thickness}
          strokeDashoffset={d.dashOffset}
          transform={`rotate(-90 ${c} ${c})`}
          strokeLinecap="butt"
          className="myra-donut-segment"
          style={{
            "--dash-length": d.dashLength,
            "--dash-gap": d.dashGap,
            "--circ": circ,
            animationDelay: `${i * 90}ms`,
          }}
        />
      ))}
      <text x={c} y={c - 4} textAnchor="middle" fontFamily="var(--font-display)" fontSize="20" fontWeight="700" fill="var(--text-2)">{centerValue}</text>
      <text x={c} y={c + 14} textAnchor="middle" fontSize="10" fill="var(--text-muted)" letterSpacing="1.2">{centerLabel}</text>
    </svg>
  );
}

function HBarRow({ label, value, max, color = "var(--accent)", fmt = (v) => v, delay = 0 }) {
  const pct = Math.max(0, Math.min(100, (toNumber(value) / Math.max(1, toNumber(max))) * 100));

  return (
    <div className="myra-hbar-row">
      <span style={{ fontSize: 12, color: "var(--text-2)" }}>{label}</span>
      <div className="myra-hbar-track">
        <div
          className="myra-hbar-fill"
          style={{ "--hbar-width": pct + "%", background: color, animationDelay: `${delay}ms` }}
        />
      </div>
      <span style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmt(value)}</span>
    </div>
  );
}

function Sparkline({ values, w = 80, h = 24, color = "var(--accent)" }) {
  const safeValues = values.length ? values.map(toNumber) : [0];
  const max = Math.max(...safeValues);
  const min = Math.min(...safeValues);
  const xs = safeValues.map((_, i) => safeValues.length > 1 ? (i / (safeValues.length - 1)) * w : w / 2);
  const ys = safeValues.map((v) => h - ((v - min) / (max - min || 1)) * h);
  const path = xs.map((x, i) => (i ? "L" : "M") + x + "," + ys[i]).join(" ");

  return (
    <svg width={w} height={h} className="myra-sparkline">
      <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" pathLength="1" className="myra-chart-line" />
    </svg>
  );
}

// ── Small sub-components ─────────────────────────────────────────────────────

function KpiTile({ label, value, delta, up, trend, accentColor = "var(--accent)" }) {
  return (
    <div className="myra-stat-tile myra-stats-reveal" style={{ "--tile-accent": accentColor }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div className="myra-label">{label}</div>
          <div className="stat-value">{value}</div>
        </div>
        {trend && <Sparkline values={trend} color={accentColor} />}
      </div>
      {delta && (
        <div className={"stat-delta" + (up ? " up" : "")}>{delta}</div>
      )}
    </div>
  );
}

function KpiLoadingTile() {
  return (
    <div className="myra-stat-tile myra-stat-tile-loading" aria-hidden="true">
      <span className="myra-skeleton-line sm" />
      <span className="myra-skeleton-line xl" />
      <span className="myra-skeleton-line md" />
    </div>
  );
}

function KpiEmptyTile({ label }) {
  return (
    <div className="myra-stat-tile myra-stats-reveal">
      <div className="myra-label">{label}</div>
      <div className="stat-value" style={{ fontSize: 18 }}>No data yet</div>
    </div>
  );
}

function ChartLoadingState({ variant = "bars", compact = false }) {
  if (variant === "donut") {
    return (
      <div className="myra-chart-loading donut" aria-hidden="true">
        <div className="myra-skeleton-donut" />
        <div className="myra-skeleton-stack">
          <span className="myra-skeleton-line lg" />
          <span className="myra-skeleton-line md" />
          <span className="myra-skeleton-line sm" />
        </div>
      </div>
    );
  }

  if (variant === "hbars") {
    return (
      <div className={"myra-chart-loading hbars" + (compact ? " compact" : "")} aria-hidden="true">
        {[70, 92, 48, 78].map((width, index) => (
          <span key={index} className="myra-skeleton-hbar" style={{ width: `${width}%` }} />
        ))}
      </div>
    );
  }

  if (variant === "line") {
    return (
      <div className={"myra-chart-loading line" + (compact ? " compact" : "")} aria-hidden="true">
        <span className="myra-skeleton-line-chart" />
      </div>
    );
  }

  const bars = variant === "grouped"
    ? [35, 66, 44, 78, 56, 88, 48, 70, 40, 64, 58, 82]
    : [42, 72, 54, 88, 46, 66, 94, 62, 76, 52, 84, 60];

  return (
    <div className={"myra-chart-loading bars" + (compact ? " compact" : "")} aria-hidden="true">
      {bars.map((height, index) => (
        <span key={index} className="myra-skeleton-bar" style={{ height: `${height}%` }} />
      ))}
    </div>
  );
}

function NoDataState() {
  return (
    <div className="myra-no-data-state">
      No data yet
    </div>
  );
}
