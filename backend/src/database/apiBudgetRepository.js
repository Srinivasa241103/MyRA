import { getPool } from "../config/dbConfig.js";

export const DEFAULT_API_BUDGET_THRESHOLDS = Object.freeze({
  half: 50,
  attention: 80,
  critical: 95,
});

export const CLAIM_API_BUDGET_ALERT_SQL = `
  INSERT INTO api_budget_alerts (
    api_budget_id,
    user_id,
    provider_key,
    period_start,
    threshold_key,
    threshold_percent,
    usage_inr,
    budget_inr,
    status,
    created_at,
    updated_at
  )
  SELECT
    $1::BIGINT,
    $2::BIGINT,
    $3::VARCHAR(100),
    $4::DATE,
    $5::VARCHAR(32),
    $6::SMALLINT,
    $7::NUMERIC(14, 4),
    $8::INTEGER,
    'sending'::VARCHAR(16),
    NOW(),
    NOW()
  WHERE NOT EXISTS (
    SELECT 1
    FROM api_budget_alerts recent
    WHERE recent.api_budget_id = $1::BIGINT
      AND recent.threshold_key = $5::VARCHAR(32)
      AND (
        (
          recent.status = 'sent'
          AND recent.sent_at >= NOW() - INTERVAL '4 days'
        )
        OR (
          recent.status = 'sending'
          AND recent.updated_at >= NOW() - INTERVAL '30 minutes'
        )
      )
  )
  ON CONFLICT (api_budget_id, period_start, threshold_key)
  DO UPDATE SET
    usage_inr = EXCLUDED.usage_inr,
    budget_inr = EXCLUDED.budget_inr,
    threshold_percent = EXCLUDED.threshold_percent,
    status = 'sending',
    last_error = NULL,
    updated_at = NOW()
  WHERE api_budget_alerts.status = 'failed'
     OR (
       api_budget_alerts.status = 'sending'
       AND api_budget_alerts.updated_at < NOW() - INTERVAL '30 minutes'
     )
  RETURNING id
`;

function mapThresholds(row = {}) {
  return {
    half: Number(
      row.api_budget_half_threshold ?? DEFAULT_API_BUDGET_THRESHOLDS.half,
    ),
    attention: Number(
      row.api_budget_attention_threshold ??
        DEFAULT_API_BUDGET_THRESHOLDS.attention,
    ),
    critical: Number(
      row.api_budget_critical_threshold ??
        DEFAULT_API_BUDGET_THRESHOLDS.critical,
    ),
  };
}

export class ApiBudgetRepository {
  async getUserSettings(userId) {
    const [userResult, budgetResult, usageResult] = await Promise.all([
      getPool().query(
        `SELECT
           id,
           email,
           api_budget_half_threshold,
           api_budget_attention_threshold,
           api_budget_critical_threshold,
           date_trunc('month', CURRENT_DATE)::date AS period_start,
           (
             date_trunc('month', CURRENT_DATE)
             + INTERVAL '1 month'
             - INTERVAL '1 day'
           )::date AS period_end
         FROM users
         WHERE id = $1`,
        [userId],
      ),
      getPool().query(
        `SELECT
           id,
           provider_key,
           provider_name,
           service_type,
           monthly_budget_inr,
           is_active,
           updated_at
         FROM api_budgets
         WHERE user_id = $1
           AND service_type = 'llm'
         ORDER BY provider_name ASC`,
        [userId],
      ),
      getPool().query(
        `SELECT
           LOWER(provider) AS provider_key,
           COALESCE(
             SUM(COALESCE(input_cost, 0) + COALESCE(output_cost, 0)),
             0
           ) AS usage_inr
         FROM llm_usage_logs
         WHERE user_id = $1
           AND created_at >= date_trunc('month', CURRENT_DATE)
           AND created_at < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
         GROUP BY LOWER(provider)`,
        [userId],
      ),
    ]);

    if (userResult.rows.length === 0) return null;

    return {
      email: userResult.rows[0].email,
      thresholds: mapThresholds(userResult.rows[0]),
      budgets: budgetResult.rows,
      usage: usageResult.rows,
      periodStart: userResult.rows[0].period_start,
      periodEnd: userResult.rows[0].period_end,
    };
  }

  async saveUserSettings(userId, budgets, thresholds) {
    const client = await getPool().connect();

    try {
      await client.query("BEGIN");

      const userResult = await client.query(
        `UPDATE users
         SET
           api_budget_half_threshold = $1,
           api_budget_attention_threshold = $2,
           api_budget_critical_threshold = $3,
           updated_at = NOW()
         WHERE id = $4
         RETURNING id`,
        [thresholds.half, thresholds.attention, thresholds.critical, userId],
      );

      if (userResult.rows.length === 0) {
        throw new Error("User not found");
      }

      for (const budget of budgets) {
        if (budget.monthlyBudgetInr === null) {
          await client.query(
            `UPDATE api_budgets
             SET is_active = FALSE, updated_at = NOW()
             WHERE user_id = $1
               AND service_type = $2
               AND provider_key = $3`,
            [userId, budget.serviceType, budget.providerKey],
          );
          continue;
        }

        await client.query(
          `INSERT INTO api_budgets (
             user_id,
             provider_key,
             provider_name,
             service_type,
             monthly_budget_inr,
             is_active,
             created_at,
             updated_at
           ) VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NOW())
           ON CONFLICT (user_id, service_type, provider_key)
           DO UPDATE SET
             provider_name = EXCLUDED.provider_name,
             service_type = EXCLUDED.service_type,
             monthly_budget_inr = EXCLUDED.monthly_budget_inr,
             is_active = TRUE,
             updated_at = NOW()`,
          [
            userId,
            budget.providerKey,
            budget.providerName,
            budget.serviceType,
            budget.monthlyBudgetInr,
          ],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return this.getUserSettings(userId);
  }

  async getCurrentMonthAlertCandidates() {
    const result = await getPool().query(
      `SELECT
         b.id AS api_budget_id,
         b.user_id,
         b.provider_key,
         b.provider_name,
         b.monthly_budget_inr,
         u.email,
         u.api_budget_half_threshold,
         u.api_budget_attention_threshold,
         u.api_budget_critical_threshold,
         date_trunc('month', CURRENT_DATE)::date AS alert_period_start,
         date_trunc('month', CURRENT_DATE)::date AS usage_period_start,
         (
           date_trunc('month', CURRENT_DATE)
           + INTERVAL '1 month'
           - INTERVAL '1 day'
         )::date AS usage_period_end,
         COALESCE(usage.total_cost_inr, 0) AS usage_inr
       FROM api_budgets b
       JOIN users u ON u.id = b.user_id
       LEFT JOIN LATERAL (
         SELECT SUM(
           COALESCE(l.input_cost, 0) + COALESCE(l.output_cost, 0)
         ) AS total_cost_inr
         FROM llm_usage_logs l
         WHERE l.user_id = b.user_id
           AND LOWER(l.provider) = b.provider_key
           AND l.created_at >= date_trunc('month', CURRENT_DATE)
           AND l.created_at < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
       ) usage ON TRUE
       WHERE b.is_active = TRUE
         AND b.service_type = 'llm'
         AND b.monthly_budget_inr > 0
         AND u.status = 'active'
         AND u.email IS NOT NULL`,
    );

    return result.rows.map((row) => ({
      ...row,
      thresholds: mapThresholds(row),
    }));
  }

  async claimAlert({
    apiBudgetId,
    userId,
    providerKey,
    periodStart,
    thresholdKey,
    thresholdPercent,
    usageInr,
    budgetInr,
  }) {
    const result = await getPool().query(
      CLAIM_API_BUDGET_ALERT_SQL,
      [
        apiBudgetId,
        userId,
        providerKey,
        periodStart,
        thresholdKey,
        thresholdPercent,
        usageInr,
        budgetInr,
      ],
    );

    return result.rows[0] ?? null;
  }

  async markAlertSent(alertId, messageId = null) {
    await getPool().query(
      `UPDATE api_budget_alerts
       SET
         status = 'sent',
         message_id = $1,
         sent_at = NOW(),
         last_error = NULL,
         updated_at = NOW()
       WHERE id = $2`,
      [messageId, alertId],
    );
  }

  async markAlertFailed(alertId, errorMessage) {
    await getPool().query(
      `UPDATE api_budget_alerts
       SET
         status = 'failed',
         last_error = $1,
         updated_at = NOW()
       WHERE id = $2`,
      [String(errorMessage || "Unknown mail error").slice(0, 2000), alertId],
    );
  }
}

export const apiBudgetRepository = new ApiBudgetRepository();
