import { useEffect, useState } from "react";
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  RefreshCw,
  Save,
} from "lucide-react";
import { budgetApi } from "../../api/budgets";
import { useAuthStore } from "../../store/authStore";

const EMPTY_THRESHOLDS = { half: "50", attention: "80", critical: "95" };

function formatInr(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function makeForm(data) {
  return {
    budgets: Object.fromEntries(
      data.providers.map((provider) => [
        provider.providerKey,
        provider.monthlyBudgetInr?.toString() ?? "",
      ]),
    ),
    thresholds: Object.fromEntries(
      Object.entries(data.thresholds).map(([key, value]) => [
        key,
        value.toString(),
      ]),
    ),
  };
}

export default function ApiBudgetSettings() {
  const { isAuthenticated } = useAuthStore();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ budgets: {}, thresholds: EMPTY_THRESHOLDS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!isAuthenticated) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      try {
        const result = await budgetApi.get();
        if (!active) return;
        setData(result);
        setForm(makeForm(result));
      } catch (loadError) {
        if (active) setError(loadError.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [isAuthenticated]);

  function updateBudget(providerKey, value) {
    setSaved(false);
    setForm((current) => ({
      ...current,
      budgets: { ...current.budgets, [providerKey]: value },
    }));
  }

  function updateThreshold(key, value) {
    setSaved(false);
    setForm((current) => ({
      ...current,
      thresholds: { ...current.thresholds, [key]: value },
    }));
  }

  async function save(event) {
    event.preventDefault();
    setError("");
    setSaved(false);

    const thresholds = Object.fromEntries(
      Object.entries(form.thresholds).map(([key, value]) => [key, Number(value)]),
    );

    if (
      Object.values(thresholds).some(
        (value) => !Number.isInteger(value) || value < 1 || value > 100,
      )
    ) {
      setError("Thresholds must be whole numbers from 1 to 100.");
      return;
    }
    if (
      thresholds.half >= thresholds.attention ||
      thresholds.attention >= thresholds.critical
    ) {
      setError("Thresholds must increase from heads up to attention to critical.");
      return;
    }

    const budgets = data.providers.map((provider) => {
      const input = form.budgets[provider.providerKey]?.trim() ?? "";
      const monthlyBudgetInr = input === "" ? null : Number(input);
      return { providerKey: provider.providerKey, monthlyBudgetInr };
    });
    if (
      budgets.some(
        ({ monthlyBudgetInr }) =>
          monthlyBudgetInr !== null &&
          (!Number.isInteger(monthlyBudgetInr) ||
            monthlyBudgetInr < 1 ||
            monthlyBudgetInr > 2_147_483_647),
      )
    ) {
      setError("Monthly budgets must be whole rupee amounts greater than zero.");
      return;
    }

    setSaving(true);
    try {
      const result = await budgetApi.update({ budgets, thresholds });
      setData(result);
      setForm(makeForm(result));
      setSaved(true);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  if (!isAuthenticated) {
    return (
      <section className="myra-card myra-budget-section">
        <div className="myra-budget-empty">
          <BellRing size={20} strokeWidth={1.7} />
          <div>
            <strong>Monthly API budgets</strong>
            <p>Sign in to set provider budgets and email alert thresholds.</p>
          </div>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="myra-card myra-budget-section myra-budget-loading">
        <RefreshCw className="myra-spin" size={18} /> Loading API budgets…
      </section>
    );
  }

  if (!data) {
    return (
      <section className="myra-card myra-budget-section">
        <div className="myra-budget-message error">
          <AlertCircle size={17} /> {error || "API budgets could not be loaded."}
        </div>
      </section>
    );
  }

  return (
    <section className="myra-card myra-budget-section">
      <div className="myra-budget-heading">
        <div>
          <span className="myra-budget-eyebrow">Usage controls</span>
          <h3><BellRing size={18} strokeWidth={1.7} /> Monthly API budgets</h3>
          <p>
            Track estimated model spend for the current month and receive email alerts. Budgets
            notify you but do not stop API requests.
          </p>
        </div>
        <span className="myra-badge">INR</span>
      </div>

      <form onSubmit={save}>
        <div className="myra-budget-provider-grid">
          {data.providers.map((provider) => {
            const progress = provider.usagePercent ?? 0;
            const configured = provider.monthlyBudgetInr !== null;

            return (
              <article className="myra-budget-provider-card" key={provider.providerKey}>
                <div className="myra-budget-provider-topline">
                  <div>
                    <span className={`myra-provider-mark ${provider.providerKey}`}>
                      {provider.providerName.charAt(0)}
                    </span>
                    <strong>{provider.providerName}</strong>
                  </div>
                  <span className={`myra-badge ${configured ? "success" : ""}`}>
                    {configured ? "Active" : "Not set"}
                  </span>
                </div>

                <div className="myra-budget-spend">
                  <span>{formatInr(provider.currentUsageInr)}</span>
                  <small>
                    {configured
                      ? `of ${formatInr(provider.monthlyBudgetInr)}`
                      : "tracked this month"}
                  </small>
                </div>
                <div className="myra-budget-progress" aria-label={`${progress}% used`}>
                  <span
                    className={progress >= data.thresholds.critical ? "critical" : progress >= data.thresholds.attention ? "attention" : ""}
                    style={{ width: `${Math.min(progress, 100)}%` }}
                  />
                </div>
                <div className="myra-budget-progress-caption">
                  {configured ? `${progress.toFixed(1)}% used` : "Add a budget to enable alerts"}
                </div>

                <label className="myra-budget-input-label">
                  Monthly budget
                  <div className="myra-budget-money-input">
                    <span>₹</span>
                    <input
                      className="myra-input"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="2147483647"
                      step="1"
                      placeholder="Not set"
                      value={form.budgets[provider.providerKey] ?? ""}
                      onChange={(event) => updateBudget(provider.providerKey, event.target.value)}
                    />
                  </div>
                </label>
              </article>
            );
          })}
        </div>

        <div className="myra-budget-threshold-panel">
          <div className="myra-budget-threshold-copy">
            <strong>Alert thresholds</strong>
            <p>Each alert is sent once per provider and threshold each month.</p>
          </div>
          <div className="myra-budget-threshold-grid">
            {[
              ["half", "Heads up"],
              ["attention", "Needs attention"],
              ["critical", "Critical"],
            ].map(([key, label]) => (
              <label key={key} className={`myra-budget-threshold ${key}`}>
                <span>{label}</span>
                <div>
                  <input
                    className="myra-input"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    value={form.thresholds[key]}
                    onChange={(event) => updateThreshold(key, event.target.value)}
                  />
                  <span>%</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="myra-budget-footer">
          <div className="myra-budget-feedback" aria-live="polite">
            {error && <span className="error"><AlertCircle size={15} />{error}</span>}
            {saved && <span className="success"><CheckCircle2 size={15} />Budget settings saved</span>}
            {!error && !saved && <span>Alerts go to {data.alertEmail}.</span>}
          </div>
          <button className="myra-btn primary" type="submit" disabled={saving}>
            {saving ? <RefreshCw className="myra-spin" size={15} /> : <Save size={15} />}
            {saving ? "Saving…" : "Save budgets"}
          </button>
        </div>
      </form>
    </section>
  );
}
