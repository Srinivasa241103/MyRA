import { useState, useEffect } from "react";
import { statsApi, DUMMY } from "../api/stats";

export default function StatsScreen() {
  const [range, setRange] = useState("14d");
  const [data, setData] = useState({
    emails:    DUMMY.emails,
    tokens:    DUMMY.tokens,
    reminders: DUMMY.reminders,
    cost:      DUMMY.cost,
    sessions:  DUMMY.sessions,
    calEvents: DUMMY.calEvents,
  });

  useEffect(() => {
    statsApi.getAll(range).then(setData).catch(() => {});
  }, [range]);

  const { emails: EMAILS_14D, tokens: TOKENS, reminders: REMINDERS_7D, cost: COST_30D, sessions: CHAT_SESSIONS, calEvents: CAL_EVENTS } = data;

  const labels14 = EMAILS_14D.map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (EMAILS_14D.length - 1 - i));
    return d.getDate();
  });

  const totalTokens = TOKENS.reduce((s, t) => s + t.value, 0);
  const totalCost   = COST_30D.reduce((s, c) => s + c.spend, 0);
  const remindersSet  = REMINDERS_7D.reduce((s, r) => s + r.set, 0);
  const remindersDone = REMINDERS_7D.reduce((s, r) => s + r.done, 0);

  return (
    <div className="myra-page-inner" style={{ paddingTop: 32, paddingBottom: 48 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 className="display lg" style={{ marginBottom: 4 }}>Your activity</h1>
          <p className="muted">Last updated just now.</p>
        </div>
        <div className="myra-pills">
          {["7d", "14d", "30d", "90d"].map((r) => (
            <button key={r} className={range === r ? "active" : ""} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>
      </div>

      {/* KPI tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <KpiTile
          label="Emails received"
          value={EMAILS_14D.reduce((s, v) => s + v, 0)}
          delta="+8% wk/wk"
          up
          trend={EMAILS_14D}
        />
        <KpiTile
          label="Tokens used"
          value={(totalTokens / 1000).toFixed(0) + "K"}
          delta="3 providers"
          trend={[210,280,240,320,290,350,410,380,460,510,480,540,590,620]}
        />
        <KpiTile
          label="Reminders"
          value={`${remindersDone}/${remindersSet}`}
          delta={Math.round(remindersDone / remindersSet * 100) + "% complete"}
          up
          trend={REMINDERS_7D.map((r) => r.done)}
        />
        <KpiTile
          label="Spend (30d)"
          value={"₹" + totalCost.toFixed(2)}
          delta="−₹2.18 vs prev"
          up
          trend={[2.1,1.8,2.4,2.0,2.6,2.3,2.1,1.9,2.5,2.2,1.7,1.9,2.0,2.0]}
        />
      </div>

      {/* Big charts */}
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16, marginBottom: 16 }}>
        <div className="myra-card">
          <div className="myra-card-header">
            <div>
              <h3>Emails received</h3>
              <span className="muted" style={{ fontSize: 12 }}>Per day · last 14 days</span>
            </div>
            <span className="myra-badge accent">avg {Math.round(EMAILS_14D.reduce((s, v) => s + v, 0) / 14)}/day</span>
          </div>
          <BarChart values={EMAILS_14D} labels={labels14} h={180} />
        </div>

        <div className="myra-card">
          <div className="myra-card-header">
            <h3>Tokens by model</h3>
            <span className="muted" style={{ fontSize: 12 }}>30 days</span>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <Donut data={TOKENS} centerLabel="TOTAL" centerValue={(totalTokens / 1e6).toFixed(2) + "M"} size={140} />
            <div style={{ flex: 1 }}>
              {TOKENS.map((t) => (
                <div key={t.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, color: "var(--text-2)" }}>{t.name}</span>
                  <span className="muted mono">{(t.value / 1e3).toFixed(0)}K</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom charts row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Reminders */}
        <div className="myra-card">
          <div className="myra-card-header">
            <h3>Reminders set vs finished</h3>
            <span className="myra-badge success">{Math.round(remindersDone / remindersSet * 100)}%</span>
          </div>
          <GroupedBars
            groups={REMINDERS_7D}
            keys={["set", "done"]}
            colors={["#D4A96A", "#7A4A2E"]}
            h={170}
          />
          <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 11 }}>
            <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#D4A96A", marginRight: 6, borderRadius: 2 }} />Set</span>
            <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#7A4A2E", marginRight: 6, borderRadius: 2 }} />Done</span>
          </div>
        </div>

        {/* Calendar events */}
        <div className="myra-card">
          <div className="myra-card-header">
            <h3>Calendar events</h3>
            <span className="muted" style={{ fontSize: 12 }}>handled by agent</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            {[["Created","34"],["Rescheduled","11"],["Cancelled","3"],["Conflicts caught","7"]].map(([label, value]) => (
              <SubKpi key={label} label={label} value={value} />
            ))}
          </div>
          <div className="myra-label" style={{ marginBottom: 6 }}>Per day</div>
          <LineChart values={CAL_EVENTS} labels={labels14} h={90} />
        </div>

        {/* Cost by provider */}
        <div className="myra-card">
          <div className="myra-card-header">
            <h3>Cost by provider</h3>
            <span className="muted" style={{ fontSize: 12 }}>Last 30 days</span>
          </div>
          {COST_30D.map((c) => (
            <HBarRow
              key={c.provider}
              label={c.provider}
              value={c.spend}
              max={Math.max(...COST_30D.map((x) => x.spend)) || 1}
              fmt={(v) => "₹" + v.toFixed(2)}
            />
          ))}
          <div className="myra-divider" style={{ margin: "12px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span className="muted">Total</span>
            <strong style={{ fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>₹{totalCost.toFixed(2)}</strong>
          </div>
        </div>
      </div>

      {/* RAG + sessions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="myra-card">
          <div className="myra-card-header">
            <h3>Documents indexed</h3>
            <button className="myra-btn ghost sm">Sync now <ZapIcon /></button>
          </div>
          <HBarRow label="Gmail"    value={4218} max={4500} />
          <HBarRow label="Drive"    value={2340} max={4500} />
          <HBarRow label="Notion"   value={891}  max={4500} color="#C9845A" />
          <HBarRow label="Calendar" value={312}  max={4500} color="#D4A96A" />
          <div className="myra-divider" style={{ margin: "12px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <span className="muted">Total chunks in vector store</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>54,318</span>
          </div>
        </div>

        <div className="myra-card">
          <div className="myra-card-header">
            <h3>Chat sessions</h3>
            <span className="muted" style={{ fontSize: 12 }}>Per day</span>
          </div>
          <BarChart values={CHAT_SESSIONS} labels={labels14} h={140} color="#C9845A" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 12 }}>
            <SubKpi label="Sessions"  value="91" />
            <SubKpi label="Avg turns" value="6.4" />
            <SubKpi label="Avg time"  value="3m 42s" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Chart components (pure SVG) ──────────────────────────────────────────────

function LineChart({ values, w = 520, h = 160, color = "var(--accent)", labels }) {
  const pad = { l: 28, r: 8, t: 12, b: 22 };
  const max = Math.max(...values) * 1.1;
  const min = 0;
  const stepX = (w - pad.l - pad.r) / (values.length - 1);
  const ys = values.map((v) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b));
  const xs = values.map((_, i) => pad.l + i * stepX);
  const path = xs.map((x, i) => (i ? "L" : "M") + x.toFixed(1) + "," + ys[i].toFixed(1)).join(" ");
  const area = path + " L " + xs[xs.length-1].toFixed(1) + "," + (h - pad.b) + " L " + xs[0].toFixed(1) + "," + (h - pad.b) + " Z";
  const ticks = [0, 0.5, 1].map((t) => Math.round(min + t * (max - min)));
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {ticks.map((t, i) => {
        const y = pad.t + (1 - (t - min) / (max - min)) * (h - pad.t - pad.b);
        return (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="var(--border)" strokeDasharray="2 4" />
            <text x={pad.l - 6} y={y + 3} fontSize="10" textAnchor="end" fill="var(--text-muted)">{t}</text>
          </g>
        );
      })}
      <path d={area} fill={color} fillOpacity={0.12} />
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {xs.map((x, i) => <circle key={i} cx={x} cy={ys[i]} r="2.5" fill={color} />)}
      {labels && labels.map((l, i) => (
        <text key={i} x={xs[i]} y={h - 6} fontSize="9" textAnchor="middle" fill="var(--text-muted)">{l}</text>
      ))}
    </svg>
  );
}

function BarChart({ values, w = 520, h = 160, color = "var(--accent)", labels }) {
  const pad = { l: 28, r: 8, t: 12, b: 22 };
  const max = Math.max(...values) * 1.15;
  const innerW = w - pad.l - pad.r;
  const bw = innerW / values.length;
  const ticks = [0, 0.5, 1].map((t) => Math.round(t * max));
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {ticks.map((t, i) => {
        const y = pad.t + (1 - t / max) * (h - pad.t - pad.b);
        return (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="var(--border)" strokeDasharray="2 4" />
            <text x={pad.l - 6} y={y + 3} fontSize="10" textAnchor="end" fill="var(--text-muted)">{t}</text>
          </g>
        );
      })}
      {values.map((v, i) => {
        const bh = (v / max) * (h - pad.t - pad.b);
        const x = pad.l + i * bw + bw * 0.18;
        const y = h - pad.b - bh;
        return <rect key={i} x={x} y={y} width={bw * 0.64} height={bh} fill={color} rx="2" />;
      })}
      {labels && labels.map((l, i) => (
        <text key={i} x={pad.l + i * bw + bw / 2} y={h - 6} fontSize="9" textAnchor="middle" fill="var(--text-muted)">{l}</text>
      ))}
    </svg>
  );
}

function GroupedBars({ groups, keys, w = 520, h = 180, colors }) {
  const pad = { l: 28, r: 8, t: 12, b: 22 };
  const max = Math.max(...groups.flatMap((g) => keys.map((k) => g[k]))) * 1.2;
  const innerW = w - pad.l - pad.r;
  const gW = innerW / groups.length;
  const bw = (gW * 0.7) / keys.length;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {[0, 0.5, 1].map((t, i) => {
        const y = pad.t + (1 - t) * (h - pad.t - pad.b);
        return <line key={i} x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="var(--border)" strokeDasharray="2 4" />;
      })}
      {groups.map((g, gi) =>
        keys.map((k, ki) => {
          const v = g[k];
          const bh = (v / max) * (h - pad.t - pad.b);
          const x = pad.l + gi * gW + gW * 0.15 + ki * bw;
          const y = h - pad.b - bh;
          return <rect key={k + gi} x={x} y={y} width={bw * 0.85} height={bh} fill={colors[ki]} rx="2" />;
        })
      )}
      {groups.map((g, gi) => (
        <text key={gi} x={pad.l + gi * gW + gW / 2} y={h - 6} fontSize="10" textAnchor="middle" fill="var(--text-muted)">
          {g.label || g.day}
        </text>
      ))}
    </svg>
  );
}

function Donut({ data, size = 160, thickness = 22, centerLabel, centerValue }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--bg-2)" strokeWidth={thickness} />
      {data.map((d, i) => {
        const len = (d.value / total) * circ;
        const dash = `${len} ${circ - len}`;
        const off = -acc;
        acc += len;
        return (
          <circle key={i} cx={c} cy={c} r={r} fill="none"
            stroke={d.color} strokeWidth={thickness}
            strokeDasharray={dash} strokeDashoffset={off}
            transform={`rotate(-90 ${c} ${c})`}
            strokeLinecap="butt"
          />
        );
      })}
      <text x={c} y={c - 4} textAnchor="middle" fontFamily="var(--font-display)" fontSize="20" fontWeight="700" fill="var(--text-2)">{centerValue}</text>
      <text x={c} y={c + 14} textAnchor="middle" fontSize="10" fill="var(--text-muted)" letterSpacing="1.2">{centerLabel}</text>
    </svg>
  );
}

function HBarRow({ label, value, max, color = "var(--accent)", fmt = (v) => v }) {
  const pct = (value / max) * 100;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 72px", alignItems: "center", gap: 12, padding: "8px 0" }}>
      <span style={{ fontSize: 12, color: "var(--text-2)" }}>{label}</span>
      <div style={{ height: 8, background: "var(--bg-2)", borderRadius: 4, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, width: pct + "%", background: color, borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmt(value)}</span>
    </div>
  );
}

function Sparkline({ values, w = 80, h = 24, color = "var(--accent)" }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const xs = values.map((_, i) => (i / (values.length - 1)) * w);
  const ys = values.map((v) => h - ((v - min) / (max - min || 1)) * h);
  const path = xs.map((x, i) => (i ? "L" : "M") + x + "," + ys[i]).join(" ");
  return <svg width={w} height={h}><path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" /></svg>;
}

// ── Small sub-components ─────────────────────────────────────────────────────

function KpiTile({ label, value, delta, up, trend }) {
  return (
    <div className="myra-stat-tile">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div className="myra-label">{label}</div>
          <div className="stat-value">{value}</div>
        </div>
        {trend && <Sparkline values={trend} />}
      </div>
      {delta && (
        <div className={"stat-delta" + (up ? " up" : "")}>{delta}</div>
      )}
    </div>
  );
}

function SubKpi({ label, value }) {
  return (
    <div style={{ background: "var(--bg-2)", borderRadius: 8, padding: "8px 10px" }}>
      <div className="myra-label" style={{ fontSize: 10, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-2)" }}>{value}</div>
    </div>
  );
}

function ZapIcon() {
  return <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>;
}
