CREATE TABLE IF NOT EXISTS cloud_schema_migrations (
  migration_id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS publication_idempotency (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  published_run_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS publication_idempotency_run
  ON publication_idempotency (tenant_id, project_id, published_run_id);

CREATE TABLE IF NOT EXISTS publication_nonces (
  tenant_id text NOT NULL,
  nonce text NOT NULL,
  idempotency_key text NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, nonce),
  FOREIGN KEY (tenant_id, idempotency_key)
    REFERENCES publication_idempotency (tenant_id, idempotency_key)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS published_run_listings (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  published_run_id text NOT NULL,
  published_at timestamptz NOT NULL,
  active_expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, published_run_id)
);

CREATE INDEX IF NOT EXISTS published_run_list_order
  ON published_run_listings (tenant_id, project_id, published_at, published_run_id);

CREATE INDEX IF NOT EXISTS published_run_retention_due
  ON published_run_listings (active_expires_at, tenant_id, project_id)
  WHERE active_expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS published_runs (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  published_run_id text NOT NULL,
  source_intent_id text NOT NULL,
  idempotency_key text NOT NULL,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^sha256:[a-f0-9]{64}$'),
  published_at timestamptz NOT NULL,
  projection jsonb NOT NULL CHECK (jsonb_typeof(projection) = 'object'),
  PRIMARY KEY (tenant_id, project_id, published_run_id),
  FOREIGN KEY (tenant_id, project_id, published_run_id)
    REFERENCES published_run_listings (tenant_id, project_id, published_run_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS published_run_tombstones (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  published_run_id text NOT NULL,
  deleted_at timestamptz NOT NULL,
  authority text NOT NULL,
  reason_class text NOT NULL CHECK (reason_class ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  affected_edge_ids jsonb NOT NULL CHECK (jsonb_typeof(affected_edge_ids) = 'array'),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, published_run_id),
  FOREIGN KEY (tenant_id, project_id, published_run_id)
    REFERENCES published_run_listings (tenant_id, project_id, published_run_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS published_run_tombstone_expiry
  ON published_run_tombstones (expires_at, tenant_id, project_id);

CREATE TABLE IF NOT EXISTS publication_outbox (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  event_id text NOT NULL,
  aggregate_type text NOT NULL CHECK (aggregate_type = 'publishedRun'),
  aggregate_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  event jsonb NOT NULL CHECK (jsonb_typeof(event) = 'object'),
  status text NOT NULL CHECK (status IN ('pending', 'leased', 'delivered', 'deadLetter')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 5),
  fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0),
  worker_id text,
  lease_expires_at timestamptz,
  failure_code text CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  PRIMARY KEY (tenant_id, event_id)
);

CREATE INDEX IF NOT EXISTS publication_outbox_claim_order
  ON publication_outbox (status, occurred_at, event_id)
  WHERE status IN ('pending', 'leased');

CREATE TABLE IF NOT EXISTS published_run_cursors (
  cursor_sequence bigserial PRIMARY KEY,
  token_digest text NOT NULL UNIQUE CHECK (token_digest ~ '^sha256:[a-f0-9]{64}$'),
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  after_published_at timestamptz NOT NULL,
  after_published_run_id text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS published_run_cursor_expiry
  ON published_run_cursors (expires_at);
