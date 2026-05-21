import { useState } from "react";
import { useAuthStore } from "../store/authStore";

// ── TODO: Wire these API endpoints when backend is ready ──────────────────
// GET  /settings/general          → load general settings
// PUT  /settings/general          → save general settings
// GET  /settings/sources          → load connected sources with sync status
// POST /sync/gmail                → trigger gmail sync (already in ProfilePage)
// POST /sync/calendar             → trigger calendar sync (already in ProfilePage)
// GET  /settings/models           → load model/api settings
// PUT  /settings/models           → save model/api settings
// PUT  /settings/notifications    → save notification prefs
// PUT  /settings/privacy          → save privacy prefs
// POST /user/export               → trigger data export
// DELETE /user                    → delete account
// ─────────────────────────────────────────────────────────────────────────

// ── Dummy data for sources (replace with live data) ───────────────────────
const SOURCES_DUMMY = [
  { id: "gmail",    name: "Gmail",          docs: 4218,  sync: "2m ago",  status: "connected" },
  { id: "gcal",     name: "Google Calendar",docs: 312,   sync: "5m ago",  status: "connected" },
  { id: "notion",   name: "Notion",         docs: 891,   sync: "1h ago",  status: "disconnected" },
  { id: "drive",    name: "Google Drive",   docs: 2340,  sync: "15m ago", status: "disconnected" },
];

const SETTINGS_TABS = [
  { id: "general",       label: "General" },
  { id: "sources",       label: "Data sources" },
  { id: "models",        label: "Models & API" },
  { id: "notifications", label: "Notifications" },
  { id: "privacy",       label: "Privacy" },
];

export default function SettingsPage({ theme = "warm", onThemeChange = () => {} }) {
  const { user } = useAuthStore();
  const [tab, setTab] = useState("general");
  const [notif, setNotif] = useState({ email: true, push: true, weekly: false });
  const [density, setDensity] = useState("comfortable");

  return (
    <div className="myra-page-inner" style={{ paddingTop: 32, paddingBottom: 48 }}>
      <h1 className="h1" style={{ marginBottom: 4 }}>Settings</h1>
      <p className="muted" style={{ marginBottom: 24 }}>Configure MyRA the way you want.</p>

      <div className="myra-settings-layout">
        {/* Tab nav */}
        <nav className="myra-settings-nav" aria-label="Settings sections">
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              className={"myra-sidebar-item" + (tab === t.id ? " active" : "")}
              style={{ borderLeft: tab === t.id ? undefined : "2px solid transparent" }}
              onClick={() => setTab(t.id)}
            >
              <span className="item-title">{t.label}</span>
            </button>
          ))}
        </nav>

        {/* Tab content */}
        <div>
          {tab === "general" && (
            <div className="myra-card">
              <h3 style={{ marginBottom: 16 }}>General</h3>
              <SettingsField label="Display name" value={user?.name || "—"} />
              <SettingsField label="Email" value={user?.email || "—"} />
              <SettingsField label="Time zone" value="Detected automatically" />
              <div className="myra-settings-row">
                <div>
                  <div className="myra-label">Dark mode</div>
                  <div className="desc">Switch the full app between Warm Pastel and Dark Professional.</div>
                </div>
                <button
                  className={"myra-toggle" + (theme === "dark" ? " on" : "")}
                  onClick={() => onThemeChange(theme === "dark" ? "warm" : "dark")}
                  aria-label="Toggle dark mode"
                  aria-pressed={theme === "dark"}
                />
              </div>
              <div className="myra-settings-row">
                <div>
                  <div className="myra-label">Density</div>
                  <div className="desc">Controls spacing and compactness of the UI.</div>
                </div>
                <div className="myra-pills">
                  <button className={density === "comfortable" ? "active" : ""} onClick={() => setDensity("comfortable")}>Comfortable</button>
                  <button className={density === "compact" ? "active" : ""} onClick={() => setDensity("compact")}>Compact</button>
                </div>
              </div>
            </div>
          )}

          {tab === "sources" && (
            <div className="myra-card">
              <div className="myra-card-header">
                <h3>Data sources</h3>
                <button className="myra-btn primary sm">
                  <PlusIcon /> Add source
                </button>
              </div>
              {SOURCES_DUMMY.map((s) => (
                <div key={s.id} className="myra-settings-row myra-settings-source-row">
                  <div className="myra-settings-source-info">
                    <div className="myra-settings-source-icon">
                      <DatabaseIcon />
                    </div>
                    <div className="myra-settings-source-text">
                      <div style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 500 }}>{s.name}</div>
                      <div className="desc">{s.docs.toLocaleString()} indexed · last sync {s.sync}</div>
                    </div>
                  </div>
                  <div className="myra-settings-row-actions">
                    <span className={"myra-badge " + (s.status === "connected" ? "success" : "warning")}>{s.status}</span>
                    <button className="myra-btn ghost sm">
                      {s.status === "connected" ? "Sync" : "Connect"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "models" && (
            <div className="myra-card">
              <h3 style={{ marginBottom: 16 }}>Models &amp; API</h3>
              <SettingsField label="Default chat model" value="Claude Haiku 4.5" badge="Recommended" />
              <SettingsField label="Embedding model" value="text-embedding-3-large" />
              <SettingsField label="Local fallback" value="Llama 3.1 (8B)" />
              <div className="myra-settings-row">
                <div>
                  <div className="myra-label">Anthropic API key</div>
                  <div className="desc mono">sk-ant-•••••••••••••••••••••••AbCd</div>
                </div>
                <button className="myra-btn ghost sm">Rotate</button>
              </div>
              <div className="myra-settings-row">
                <div>
                  <div className="myra-label">OpenAI API key</div>
                  <div className="desc mono">sk-•••••••••••••••••••••••••••rT0z</div>
                </div>
                <button className="myra-btn ghost sm">Rotate</button>
              </div>
              <div className="myra-settings-row">
                <div>
                  <div className="myra-label">Monthly spend cap</div>
                  <div className="desc">Pause requests when threshold is reached.</div>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-2)", fontSize: 13 }}>$50.00</span>
              </div>
            </div>
          )}

          {tab === "notifications" && (
            <div className="myra-card">
              <h3 style={{ marginBottom: 16 }}>Notifications</h3>
              <ToggleRow
                label="Email digests"
                desc="Daily summary of important emails."
                on={notif.email}
                onClick={() => setNotif((n) => ({ ...n, email: !n.email }))}
              />
              <ToggleRow
                label="Reminder push"
                desc="Alert me 30 min before a reminder is due."
                on={notif.push}
                onClick={() => setNotif((n) => ({ ...n, push: !n.push }))}
              />
              <ToggleRow
                label="Weekly review"
                desc="Sunday evening recap of the week."
                on={notif.weekly}
                onClick={() => setNotif((n) => ({ ...n, weekly: !n.weekly }))}
              />
            </div>
          )}

          {tab === "privacy" && (
            <div className="myra-card">
              <h3 style={{ marginBottom: 16 }}>Privacy</h3>
              <ToggleRow
                label="Train on my data"
                desc="Used only to improve your personal RAG index."
                on={true}
                onClick={() => {}}
              />
              <ToggleRow
                label="Share anonymous telemetry"
                desc="Helps us catch bugs faster."
                on={false}
                onClick={() => {}}
              />
              <div className="myra-settings-row">
                <div>
                  <div className="myra-label">Export your data</div>
                  <div className="desc">Download a ZIP of indexed content + chat history.</div>
                </div>
                <button className="myra-btn secondary sm">Export</button>
              </div>
              <div className="myra-settings-row">
                <div>
                  <div className="myra-label" style={{ color: "var(--danger)" }}>Delete account</div>
                  <div className="desc">Permanently remove your account and all data.</div>
                </div>
                <button className="myra-btn danger sm">Delete</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SettingsField({ label, value, badge }) {
  return (
    <div className="myra-settings-row">
      <div>
        <div className="myra-label">{label}</div>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2 }}>{value}</div>
      </div>
      <div className="myra-settings-row-actions">
        {badge && <span className="myra-badge accent">{badge}</span>}
        <button className="myra-btn ghost sm">Change</button>
      </div>
    </div>
  );
}

function ToggleRow({ label, desc, on, onClick }) {
  return (
    <div className="myra-settings-row">
      <div>
        <div style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 500 }}>{label}</div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      <button
        className={"myra-toggle" + (on ? " on" : "")}
        onClick={onClick}
        aria-pressed={on}
      />
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3"/>
      <path d="M3 5v6c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 11v6c0 1.7 4 3 9 3s9-1.3 9-3v-6"/>
    </svg>
  );
}
