CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  conversation_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  flow TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  schema_version TEXT NOT NULL,
  flow_contract_version TEXT,
  graph_version TEXT,
  request_payload JSONB NOT NULL,
  state JSONB NOT NULL,
  budget_limits JSONB NOT NULL,
  budget_usage JSONB NOT NULL,
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_runs_flow_check CHECK (
    flow IN (
      'simple_lookup',
      'cross_source_answer',
      'meeting_brief',
      'schedule_meeting',
      'email_compose',
      'email_reply',
      'post_meeting_followup'
    )
  ),
  CONSTRAINT agent_runs_status_check CHECK (
    status IN (
      'created',
      'planning',
      'researching',
      'synthesizing',
      'verifying',
      'waiting_for_clarification',
      'waiting_for_approval',
      'executing_action',
      'verifying_action',
      'curating_memory',
      'completed',
      'partially_completed',
      'failed',
      'cancelled'
    )
  ),
  CONSTRAINT agent_runs_flow_version_check CHECK (
    (flow IS NULL AND flow_contract_version IS NULL)
    OR (flow IS NOT NULL AND flow_contract_version IS NOT NULL)
  ),
  CONSTRAINT agent_runs_user_identity UNIQUE (id, user_id)
);

CREATE INDEX agent_runs_user_created_idx
  ON agent_runs (user_id, created_at DESC);
CREATE INDEX agent_runs_user_conversation_idx
  ON agent_runs (user_id, conversation_id, created_at DESC);
CREATE INDEX agent_runs_user_status_idx
  ON agent_runs (user_id, status, updated_at DESC);

CREATE TABLE agent_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  user_id BIGINT NOT NULL,
  step_key TEXT NOT NULL,
  step_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  attempt SMALLINT NOT NULL DEFAULT 1,
  sequence_number INTEGER NOT NULL,
  input_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  output_summary JSONB,
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_steps_run_fk
    FOREIGN KEY (run_id, user_id)
    REFERENCES agent_runs (id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT agent_steps_status_check CHECK (
    status IN ('created', 'running', 'waiting', 'completed', 'failed', 'cancelled')
  ),
  CONSTRAINT agent_steps_attempt_check CHECK (attempt > 0),
  CONSTRAINT agent_steps_sequence_check CHECK (sequence_number >= 0),
  CONSTRAINT agent_steps_run_key_attempt_unique UNIQUE (run_id, step_key, attempt),
  CONSTRAINT agent_steps_user_identity UNIQUE (id, user_id)
);

CREATE INDEX agent_steps_user_run_sequence_idx
  ON agent_steps (user_id, run_id, sequence_number, attempt);
CREATE INDEX agent_steps_user_status_idx
  ON agent_steps (user_id, status, updated_at DESC);

CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT,
  user_id BIGINT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_schema_version TEXT NOT NULL,
  connector TEXT NOT NULL,
  capability TEXT NOT NULL,
  mode TEXT NOT NULL,
  risk TEXT NOT NULL,
  arguments_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count SMALLINT NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  result_summary JSONB,
  normalized_error JSONB,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tool_calls_run_fk
    FOREIGN KEY (run_id, user_id)
    REFERENCES agent_runs (id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT tool_calls_step_fk
    FOREIGN KEY (step_id, user_id)
    REFERENCES agent_steps (id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT tool_calls_mode_check CHECK (
    mode IN ('read', 'draft', 'write', 'destructive', 'prohibited')
  ),
  CONSTRAINT tool_calls_risk_check CHECK (risk IN ('low', 'medium', 'high')),
  CONSTRAINT tool_calls_status_check CHECK (
    status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled', 'unknown')
  ),
  CONSTRAINT tool_calls_retry_count_check CHECK (retry_count >= 0),
  CONSTRAINT tool_calls_latency_check CHECK (latency_ms IS NULL OR latency_ms >= 0),
  CONSTRAINT tool_calls_user_identity UNIQUE (id, user_id)
);

CREATE INDEX tool_calls_user_run_created_idx
  ON tool_calls (user_id, run_id, created_at);
CREATE INDEX tool_calls_user_status_idx
  ON tool_calls (user_id, status, updated_at DESC);

CREATE TABLE evidence_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tool_call_id TEXT,
  user_id BIGINT NOT NULL,
  source TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  canonical_url TEXT,
  title TEXT,
  content TEXT NOT NULL,
  author TEXT,
  occurred_at TIMESTAMPTZ,
  retrieved_at TIMESTAMPTZ NOT NULL,
  freshness TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  permission_scope TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT evidence_items_run_fk
    FOREIGN KEY (run_id, user_id)
    REFERENCES agent_runs (id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT evidence_items_tool_call_fk
    FOREIGN KEY (tool_call_id, user_id)
    REFERENCES tool_calls (id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_items_source_check CHECK (
    source IN (
      'gmail',
      'calendar',
      'slack',
      'notion',
      'drive',
      'memory',
      'index',
      'user_input',
      'action_receipt'
    )
  ),
  CONSTRAINT evidence_items_freshness_check CHECK (
    freshness IN (
      'live',
      'recent_index',
      'stale_index',
      'memory',
      'user_input',
      'verified_action'
    )
  ),
  CONSTRAINT evidence_items_content_hash_check CHECK (LENGTH(content_hash) >= 32),
  CONSTRAINT evidence_items_user_identity UNIQUE (id, user_id)
);

CREATE INDEX evidence_items_user_run_created_idx
  ON evidence_items (user_id, run_id, created_at);
CREATE INDEX evidence_items_user_source_record_idx
  ON evidence_items (user_id, source, source_record_id);
CREATE INDEX evidence_items_user_content_hash_idx
  ON evidence_items (user_id, content_hash);

CREATE TABLE action_proposals (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  user_id BIGINT NOT NULL,
  connector TEXT NOT NULL,
  action_type TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  risk TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  proposal_version TEXT NOT NULL,
  requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  normalized_payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  evidence_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'proposed',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT action_proposals_run_fk
    FOREIGN KEY (run_id, user_id)
    REFERENCES agent_runs (id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT action_proposals_risk_check CHECK (risk IN ('low', 'medium', 'high')),
  CONSTRAINT action_proposals_status_check CHECK (
    status IN ('proposed', 'waiting_for_approval', 'approved', 'rejected', 'expired')
  ),
  CONSTRAINT action_proposals_approval_check CHECK (requires_approval = TRUE),
  CONSTRAINT action_proposals_payload_hash_check CHECK (LENGTH(payload_hash) >= 32),
  CONSTRAINT action_proposals_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT action_proposals_user_identity UNIQUE (id, user_id),
  CONSTRAINT action_proposals_payload_identity UNIQUE (id, user_id, payload_hash),
  CONSTRAINT action_proposals_approval_identity UNIQUE (
    id,
    user_id,
    action_id,
    run_id,
    proposal_version,
    payload_hash
  ),
  CONSTRAINT action_proposals_receipt_identity UNIQUE (
    id,
    user_id,
    action_id,
    run_id,
    connector,
    action_type,
    proposal_version,
    payload_hash
  )
);

CREATE INDEX action_proposals_user_run_created_idx
  ON action_proposals (user_id, run_id, created_at DESC);
CREATE INDEX action_proposals_user_status_idx
  ON action_proposals (user_id, status, updated_at DESC);

CREATE TABLE action_approvals (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  user_id BIGINT NOT NULL,
  proposal_version TEXT NOT NULL,
  decision TEXT NOT NULL,
  proposal_hash TEXT NOT NULL,
  reason TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT action_approvals_proposal_fk
    FOREIGN KEY (
      proposal_id,
      user_id,
      action_id,
      run_id,
      proposal_version,
      proposal_hash
    )
    REFERENCES action_proposals (
      id,
      user_id,
      action_id,
      run_id,
      proposal_version,
      payload_hash
    )
    ON DELETE CASCADE,
  CONSTRAINT action_approvals_run_fk
    FOREIGN KEY (run_id, user_id)
    REFERENCES agent_runs (id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT action_approvals_decision_check CHECK (decision IN ('approve', 'reject')),
  CONSTRAINT action_approvals_hash_check CHECK (LENGTH(proposal_hash) >= 32),
  CONSTRAINT action_approvals_one_decision_per_proposal UNIQUE (proposal_id),
  CONSTRAINT action_approvals_user_identity UNIQUE (id, user_id),
  CONSTRAINT action_approvals_receipt_identity UNIQUE (
    id,
    user_id,
    proposal_id,
    action_id,
    run_id,
    proposal_version,
    proposal_hash
  )
);

CREATE INDEX action_approvals_user_decided_idx
  ON action_approvals (user_id, decided_at DESC);

CREATE TABLE idempotency_records (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  user_id BIGINT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',
  external_id TEXT,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT idempotency_records_proposal_fk
    FOREIGN KEY (proposal_id, user_id, request_hash)
    REFERENCES action_proposals (id, user_id, payload_hash)
    ON DELETE RESTRICT,
  CONSTRAINT idempotency_records_status_check CHECK (
    status IN ('reserved', 'executing', 'succeeded', 'failed', 'unknown')
  ),
  CONSTRAINT idempotency_records_request_hash_check CHECK (LENGTH(request_hash) >= 32),
  CONSTRAINT idempotency_records_user_key_unique UNIQUE (user_id, idempotency_key),
  CONSTRAINT idempotency_records_one_per_proposal UNIQUE (proposal_id),
  CONSTRAINT idempotency_records_user_identity UNIQUE (id, user_id)
);

CREATE INDEX idempotency_records_user_status_idx
  ON idempotency_records (user_id, status, updated_at DESC);

CREATE TABLE action_receipts (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  approval_decision_id TEXT NOT NULL,
  idempotency_record_id BIGINT NOT NULL,
  run_id TEXT NOT NULL,
  user_id BIGINT NOT NULL,
  connector TEXT NOT NULL,
  provider TEXT NOT NULL,
  action_type TEXT NOT NULL,
  proposal_version TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  external_id TEXT,
  status TEXT NOT NULL,
  provider_payload_hash TEXT,
  provider_result JSONB,
  error JSONB,
  reconciliation_required BOOLEAN NOT NULL DEFAULT FALSE,
  reconciliation_metadata JSONB,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT action_receipts_proposal_fk
    FOREIGN KEY (
      proposal_id,
      user_id,
      action_id,
      run_id,
      connector,
      action_type,
      proposal_version,
      payload_hash
    )
    REFERENCES action_proposals (
      id,
      user_id,
      action_id,
      run_id,
      connector,
      action_type,
      proposal_version,
      payload_hash
    )
    ON DELETE RESTRICT,
  CONSTRAINT action_receipts_approval_fk
    FOREIGN KEY (
      approval_decision_id,
      user_id,
      proposal_id,
      action_id,
      run_id,
      proposal_version,
      payload_hash
    )
    REFERENCES action_approvals (
      id,
      user_id,
      proposal_id,
      action_id,
      run_id,
      proposal_version,
      proposal_hash
    )
    ON DELETE RESTRICT,
  CONSTRAINT action_receipts_idempotency_fk
    FOREIGN KEY (idempotency_record_id, user_id)
    REFERENCES idempotency_records (id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT action_receipts_run_fk
    FOREIGN KEY (run_id, user_id)
    REFERENCES agent_runs (id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT action_receipts_status_check CHECK (status IN ('succeeded', 'failed', 'unknown')),
  CONSTRAINT action_receipts_verification_check CHECK (
    verification_status IN ('pending', 'verified', 'mismatch', 'unavailable')
  ),
  CONSTRAINT action_receipts_payload_hash_check CHECK (LENGTH(payload_hash) >= 32),
  CONSTRAINT action_receipts_provider_payload_hash_check CHECK (
    provider_payload_hash IS NULL OR LENGTH(provider_payload_hash) >= 32
  ),
  CONSTRAINT action_receipts_outcome_shape_check CHECK (
    (
      status = 'succeeded'
      AND external_id IS NOT NULL
      AND provider_result IS NOT NULL
      AND error IS NULL
      AND reconciliation_required = FALSE
    )
    OR (
      status = 'failed'
      AND error IS NOT NULL
      AND reconciliation_required = FALSE
    )
    OR (
      status = 'unknown'
      AND error IS NOT NULL
      AND reconciliation_required = TRUE
      AND reconciliation_metadata IS NOT NULL
    )
  ),
  CONSTRAINT action_receipts_one_per_proposal UNIQUE (proposal_id),
  CONSTRAINT action_receipts_one_per_idempotency UNIQUE (idempotency_record_id),
  CONSTRAINT action_receipts_user_identity UNIQUE (id, user_id)
);

CREATE INDEX action_receipts_user_created_idx
  ON action_receipts (user_id, created_at DESC);
CREATE UNIQUE INDEX action_receipts_user_provider_external_unique
  ON action_receipts (user_id, provider, external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE connector_installations (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  connector TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected',
  capabilities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  credential_reference TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_health_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT connector_installations_status_check CHECK (
    status IN ('connected', 'disconnected', 'error', 'revoked')
  ),
  CONSTRAINT connector_installations_user_connector_unique UNIQUE (user_id, connector),
  CONSTRAINT connector_installations_user_identity UNIQUE (id, user_id)
);

CREATE INDEX connector_installations_user_status_idx
  ON connector_installations (user_id, status, updated_at DESC);

CREATE TABLE audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL,
  run_id TEXT,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_events_run_fk
    FOREIGN KEY (run_id, user_id)
    REFERENCES agent_runs (id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT audit_events_user_identity UNIQUE (id, user_id)
);

CREATE INDEX audit_events_user_created_idx
  ON audit_events (user_id, created_at DESC);
CREATE INDEX audit_events_user_entity_idx
  ON audit_events (user_id, entity_type, entity_id, created_at DESC);
CREATE INDEX audit_events_user_run_idx
  ON audit_events (user_id, run_id, created_at)
  WHERE run_id IS NOT NULL;
