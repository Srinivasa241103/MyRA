-- FND-03 follow-up: make cross-record scope and approval invariants enforceable
-- by PostgreSQL, not only by repository query conventions.

ALTER TABLE agent_steps
  ADD CONSTRAINT agent_steps_run_identity
  UNIQUE (id, user_id, run_id);

ALTER TABLE tool_calls
  ADD CONSTRAINT tool_calls_run_identity
  UNIQUE (id, user_id, run_id);

ALTER TABLE tool_calls
  DROP CONSTRAINT tool_calls_step_fk;

ALTER TABLE tool_calls
  ADD CONSTRAINT tool_calls_step_fk
  FOREIGN KEY (step_id, user_id, run_id)
  REFERENCES agent_steps (id, user_id, run_id)
  ON DELETE RESTRICT;

ALTER TABLE evidence_items
  DROP CONSTRAINT evidence_items_tool_call_fk;

ALTER TABLE evidence_items
  ADD CONSTRAINT evidence_items_tool_call_fk
  FOREIGN KEY (tool_call_id, user_id, run_id)
  REFERENCES tool_calls (id, user_id, run_id)
  ON DELETE RESTRICT;

ALTER TABLE tool_calls
  ADD CONSTRAINT tool_calls_arguments_hash_check
  CHECK (arguments_hash ~ '^[0-9A-Fa-f]{64}$');

ALTER TABLE evidence_items
  DROP CONSTRAINT evidence_items_content_hash_check;

ALTER TABLE evidence_items
  ADD CONSTRAINT evidence_items_content_hash_check
  CHECK (content_hash ~ '^[0-9A-Fa-f]{64}$');

ALTER TABLE action_proposals
  DROP CONSTRAINT action_proposals_risk_check;

ALTER TABLE action_proposals
  ADD CONSTRAINT action_proposals_risk_check
  CHECK (risk IN ('medium', 'high'));

ALTER TABLE action_proposals
  DROP CONSTRAINT action_proposals_payload_hash_check;

ALTER TABLE action_proposals
  ADD CONSTRAINT action_proposals_payload_hash_check
  CHECK (payload_hash ~ '^[0-9A-Fa-f]{64}$');

ALTER TABLE action_approvals
  DROP CONSTRAINT action_approvals_hash_check;

ALTER TABLE action_approvals
  ADD CONSTRAINT action_approvals_hash_check
  CHECK (proposal_hash ~ '^[0-9A-Fa-f]{64}$');

ALTER TABLE action_approvals
  ADD CONSTRAINT action_approvals_execution_identity
  UNIQUE (id, user_id, proposal_id, proposal_hash);

ALTER TABLE idempotency_records
  ADD COLUMN approval_decision_id TEXT;

UPDATE idempotency_records AS idempotency
SET approval_decision_id = approval.id
FROM action_approvals AS approval
WHERE approval.proposal_id = idempotency.proposal_id
  AND approval.user_id = idempotency.user_id
  AND approval.proposal_hash = idempotency.request_hash
  AND approval.decision = 'approve';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM idempotency_records
    WHERE approval_decision_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot harden idempotency records: an execution exists without a matching approval';
  END IF;
END
$$;

ALTER TABLE idempotency_records
  ALTER COLUMN approval_decision_id SET NOT NULL;

ALTER TABLE idempotency_records
  DROP CONSTRAINT idempotency_records_request_hash_check;

ALTER TABLE idempotency_records
  ADD CONSTRAINT idempotency_records_request_hash_check
  CHECK (request_hash ~ '^[0-9A-Fa-f]{64}$');

ALTER TABLE idempotency_records
  ADD CONSTRAINT idempotency_records_approval_fk
  FOREIGN KEY (approval_decision_id, user_id, proposal_id, request_hash)
  REFERENCES action_approvals (id, user_id, proposal_id, proposal_hash)
  ON DELETE RESTRICT;

ALTER TABLE idempotency_records
  ADD CONSTRAINT idempotency_records_execution_identity
  UNIQUE (
    id,
    user_id,
    proposal_id,
    approval_decision_id,
    request_hash,
    idempotency_key
  );

ALTER TABLE action_receipts
  DROP CONSTRAINT action_receipts_idempotency_fk;

ALTER TABLE action_receipts
  ADD CONSTRAINT action_receipts_idempotency_fk
  FOREIGN KEY (
    idempotency_record_id,
    user_id,
    proposal_id,
    approval_decision_id,
    payload_hash,
    idempotency_key
  )
  REFERENCES idempotency_records (
    id,
    user_id,
    proposal_id,
    approval_decision_id,
    request_hash,
    idempotency_key
  )
  ON DELETE RESTRICT;

ALTER TABLE action_receipts
  DROP CONSTRAINT action_receipts_payload_hash_check;

ALTER TABLE action_receipts
  ADD CONSTRAINT action_receipts_payload_hash_check
  CHECK (payload_hash ~ '^[0-9A-Fa-f]{64}$');

ALTER TABLE action_receipts
  DROP CONSTRAINT action_receipts_provider_payload_hash_check;

ALTER TABLE action_receipts
  ADD CONSTRAINT action_receipts_provider_payload_hash_check
  CHECK (
    provider_payload_hash IS NULL
    OR provider_payload_hash ~ '^[0-9A-Fa-f]{64}$'
  );
