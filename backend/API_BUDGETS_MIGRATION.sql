BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS api_budget_half_threshold SMALLINT NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS api_budget_attention_threshold SMALLINT NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS api_budget_critical_threshold SMALLINT NOT NULL DEFAULT 95;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_api_budget_thresholds_check'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_api_budget_thresholds_check
      CHECK (
        api_budget_half_threshold BETWEEN 1 AND 100
        AND api_budget_attention_threshold BETWEEN 1 AND 100
        AND api_budget_critical_threshold BETWEEN 1 AND 100
        AND api_budget_half_threshold < api_budget_attention_threshold
        AND api_budget_attention_threshold < api_budget_critical_threshold
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS api_budgets (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_key VARCHAR(100) NOT NULL,
  provider_name VARCHAR(150) NOT NULL,
  service_type VARCHAR(50) NOT NULL DEFAULT 'llm',
  monthly_budget_inr INTEGER NOT NULL CHECK (monthly_budget_inr > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT api_budgets_provider_key_lowercase_check
    CHECK (provider_key = LOWER(provider_key)),
  CONSTRAINT api_budgets_user_service_provider_unique
    UNIQUE (user_id, service_type, provider_key)
);

CREATE INDEX IF NOT EXISTS api_budgets_active_service_idx
  ON api_budgets (service_type, is_active);

CREATE TABLE IF NOT EXISTS api_budget_alerts (
  id BIGSERIAL PRIMARY KEY,
  api_budget_id BIGINT NOT NULL REFERENCES api_budgets(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_key VARCHAR(100) NOT NULL,
  period_start DATE NOT NULL,
  threshold_key VARCHAR(32) NOT NULL,
  threshold_percent SMALLINT NOT NULL CHECK (threshold_percent BETWEEN 1 AND 100),
  usage_inr NUMERIC(14, 4) NOT NULL DEFAULT 0,
  budget_inr INTEGER NOT NULL CHECK (budget_inr > 0),
  status VARCHAR(16) NOT NULL DEFAULT 'sending',
  message_id TEXT,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT api_budget_alerts_status_check
    CHECK (status IN ('sending', 'sent', 'failed')),
  CONSTRAINT api_budget_alerts_monthly_threshold_unique
    UNIQUE (api_budget_id, period_start, threshold_key)
);

CREATE INDEX IF NOT EXISTS api_budget_alerts_user_period_idx
  ON api_budget_alerts (user_id, period_start DESC);

COMMIT;
