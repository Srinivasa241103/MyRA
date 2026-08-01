import {
  apiBudgetRepository,
  DEFAULT_API_BUDGET_THRESHOLDS,
} from "../../database/apiBudgetRepository.js";
import { logger } from "../../utils/logger.js";

const PROVIDERS = Object.freeze([
  {
    providerKey: "openai",
    providerName: "OpenAI",
    serviceType: "llm",
  },
  {
    providerKey: "anthropic",
    providerName: "Anthropic",
    serviceType: "llm",
  },
]);

const MAX_BUDGET_INR = 2_147_483_647;

function parseThresholds(value) {
  const raw = value ?? DEFAULT_API_BUDGET_THRESHOLDS;
  const thresholds = {
    half: Number(raw.half),
    attention: Number(raw.attention),
    critical: Number(raw.critical),
  };

  if (
    Object.values(thresholds).some(
      (threshold) =>
        !Number.isInteger(threshold) || threshold < 1 || threshold > 100,
    )
  ) {
    throw new Error("Alert thresholds must be whole numbers from 1 to 100.");
  }

  if (
    thresholds.half >= thresholds.attention ||
    thresholds.attention >= thresholds.critical
  ) {
    throw new Error(
      "Alert thresholds must increase from half to attention to critical.",
    );
  }

  return thresholds;
}

function parseBudgets(value) {
  if (!Array.isArray(value)) {
    throw new Error("Budgets must be provided as a list.");
  }

  const knownProviders = new Map(
    PROVIDERS.map((provider) => [provider.providerKey, provider]),
  );
  const seen = new Set();

  return value.map((budget) => {
    const provider = knownProviders.get(budget?.providerKey);
    if (!provider) {
      throw new Error("Only OpenAI and Anthropic budgets can be changed here.");
    }
    if (seen.has(provider.providerKey)) {
      throw new Error(`Duplicate budget for ${provider.providerName}.`);
    }
    seen.add(provider.providerKey);

    const empty =
      budget.monthlyBudgetInr === null || budget.monthlyBudgetInr === "";
    const monthlyBudgetInr = empty ? null : Number(budget.monthlyBudgetInr);

    if (
      monthlyBudgetInr !== null &&
      (!Number.isInteger(monthlyBudgetInr) ||
        monthlyBudgetInr < 1 ||
        monthlyBudgetInr > MAX_BUDGET_INR)
    ) {
      throw new Error(
        `${provider.providerName} budget must be a whole rupee amount greater than zero.`,
      );
    }

    return { ...provider, monthlyBudgetInr };
  });
}

function toResponse(settings) {
  const budgetByProvider = new Map(
    settings.budgets.map((budget) => [budget.provider_key, budget]),
  );
  const usageByProvider = new Map(
    settings.usage.map((usage) => [usage.provider_key, usage]),
  );

  const providers = PROVIDERS.map((provider) => {
    const budget = budgetByProvider.get(provider.providerKey);
    const currentUsageInr = Number(
      usageByProvider.get(provider.providerKey)?.usage_inr ?? 0,
    );
    const monthlyBudgetInr = budget?.is_active
      ? Number(budget.monthly_budget_inr)
      : null;

    return {
      ...provider,
      monthlyBudgetInr,
      currentUsageInr: Number(currentUsageInr.toFixed(2)),
      usagePercent:
        monthlyBudgetInr === null
          ? null
          : Number(((currentUsageInr / monthlyBudgetInr) * 100).toFixed(1)),
      isConfigured: monthlyBudgetInr !== null,
    };
  });

  return {
    currency: "INR",
    period: {
      start: settings.periodStart,
      end: settings.periodEnd,
      type: "calendar-month",
    },
    alertEmail: settings.email,
    thresholds: settings.thresholds,
    providers,
  };
}

class ApiBudgetController {
  async get(req, res) {
    try {
      const settings = await apiBudgetRepository.getUserSettings(
        req.user.userId,
      );

      if (!settings) {
        return res.status(404).json({ success: false, error: "User not found." });
      }

      return res.status(200).json({ success: true, data: toResponse(settings) });
    } catch (error) {
      logger.error("Failed to load API budget settings", {
        userId: req.user?.userId,
        error: error.message,
      });
      return res.status(500).json({
        success: false,
        error: "Failed to load API budget settings.",
      });
    }
  }

  async update(req, res) {
    let thresholds;
    let budgets;

    try {
      thresholds = parseThresholds(req.body?.thresholds);
      budgets = parseBudgets(req.body?.budgets);
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }

    try {
      const settings = await apiBudgetRepository.saveUserSettings(
        req.user.userId,
        budgets,
        thresholds,
      );
      return res.status(200).json({ success: true, data: toResponse(settings) });
    } catch (error) {
      logger.error("Failed to update API budget settings", {
        userId: req.user?.userId,
        error: error.message,
      });
      const status = error.message === "User not found" ? 404 : 500;
      return res.status(status).json({
        success: false,
        error:
          status === 404
            ? "User not found."
            : "Failed to update API budget settings.",
      });
    }
  }
}

export default new ApiBudgetController();
