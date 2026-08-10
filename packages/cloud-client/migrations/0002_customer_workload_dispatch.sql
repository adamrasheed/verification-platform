CREATE TABLE IF NOT EXISTS cloud_schema_migrations (
  migration_id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS workload_dispatches (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  dispatch_id text NOT NULL,
  workload_binding text NOT NULL,
  idempotency_key text NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  request jsonb NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  state text NOT NULL CHECK (state IN (
    'queued', 'offered', 'running', 'cancellation_requested',
    'completed', 'cancelled', 'expired', 'failed'
  )),
  admitted_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  verify_invocation_id text,
  published_run_id text,
  cancellation jsonb CHECK (cancellation IS NULL OR jsonb_typeof(cancellation) = 'object'),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reason_codes) = 'array'),
  worker_id text,
  fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 5),
  lease_expires_at timestamptz,
  completion_digest text CHECK (
    completion_digest IS NULL OR completion_digest ~ '^sha256:[a-f0-9]{64}$'
  ),
  PRIMARY KEY (tenant_id, project_id, dispatch_id),
  UNIQUE (tenant_id, dispatch_id)
);

CREATE INDEX IF NOT EXISTS workload_dispatch_claim_order
  ON workload_dispatches (workload_binding, state, admitted_at, dispatch_id);

CREATE TABLE IF NOT EXISTS workload_dispatch_idempotency (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  dispatch_id text NOT NULL,
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, project_id, dispatch_id)
    REFERENCES workload_dispatches (tenant_id, project_id, dispatch_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS workload_dispatch_outbox (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  dispatch_id text NOT NULL,
  event_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  event jsonb NOT NULL CHECK (jsonb_typeof(event) = 'object'),
  status text NOT NULL CHECK (status IN ('pending', 'leased', 'delivered')),
  fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 5),
  worker_id text,
  lease_expires_at timestamptz,
  PRIMARY KEY (tenant_id, event_id),
  UNIQUE (tenant_id, project_id, dispatch_id),
  FOREIGN KEY (tenant_id, project_id, dispatch_id)
    REFERENCES workload_dispatches (tenant_id, project_id, dispatch_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS workload_dispatch_outbox_claim_order
  ON workload_dispatch_outbox (status, occurred_at, event_id)
  WHERE status IN ('pending', 'leased');
