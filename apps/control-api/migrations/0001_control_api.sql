CREATE TABLE IF NOT EXISTS control_api_schema_migrations (
  migration_id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS control_principals (
  principal_id text PRIMARY KEY,
  principal_kind text NOT NULL CHECK (principal_kind IN ('user', 'workload', 'integration', 'operator')),
  identity_key_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  CHECK (length(principal_id) BETWEEN 1 AND 256),
  CHECK (length(identity_key_id) BETWEEN 1 AND 256)
);

CREATE TABLE IF NOT EXISTS control_identity_token_revocations (
  principal_id text NOT NULL REFERENCES control_principals(principal_id) ON DELETE CASCADE,
  token_id text NOT NULL,
  revoked_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (principal_id, token_id),
  CHECK (length(token_id) BETWEEN 1 AND 256),
  CHECK (expires_at > revoked_at)
);

CREATE TABLE IF NOT EXISTS control_authorization_grants (
  grant_id text PRIMARY KEY,
  principal_id text NOT NULL REFERENCES control_principals(principal_id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN (
    'project:read', 'dispatch:create', 'dispatch:cancel', 'run:publish',
    'run:readPublished', 'policy:read', 'policy:admin', 'membership:admin',
    'deletion:request', 'usage:read'
  )),
  tenant_id text NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('tenant', 'project', 'dispatch', 'publishedRun', 'policy')),
  resource_id text NOT NULL,
  policy_revision text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  CHECK (length(grant_id) BETWEEN 1 AND 256),
  CHECK (length(tenant_id) BETWEEN 1 AND 256),
  CHECK (length(resource_id) BETWEEN 1 AND 256),
  CHECK (length(policy_revision) BETWEEN 1 AND 256),
  CHECK (
    (action IN ('project:read', 'dispatch:create', 'run:publish') AND resource_type = 'project') OR
    (action = 'dispatch:cancel' AND resource_type = 'dispatch') OR
    (action = 'run:readPublished' AND resource_type = 'publishedRun') OR
    (action IN ('policy:read', 'policy:admin') AND resource_type = 'policy') OR
    (action IN ('membership:admin', 'deletion:request', 'usage:read') AND resource_type = 'tenant')
  )
);

CREATE INDEX IF NOT EXISTS control_authorization_grants_exact_lookup
  ON control_authorization_grants
  (principal_id, action, tenant_id, resource_type, resource_id, expires_at)
  WHERE revoked = false;

CREATE TABLE IF NOT EXISTS control_publication_policies (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  policy_id text NOT NULL,
  revision_id text NOT NULL,
  policy jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, project_id, policy_id, revision_id),
  CHECK (length(tenant_id) BETWEEN 1 AND 256),
  CHECK (length(project_id) BETWEEN 1 AND 256),
  CHECK (length(policy_id) BETWEEN 1 AND 256),
  CHECK (length(revision_id) BETWEEN 1 AND 256),
  CHECK (jsonb_typeof(policy) = 'object')
);

CREATE TABLE IF NOT EXISTS control_publication_intents (
  principal_id text NOT NULL REFERENCES control_principals(principal_id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  signed_intent jsonb NOT NULL CHECK (jsonb_typeof(signed_intent) = 'object'),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (principal_id, tenant_id, project_id, idempotency_key),
  CHECK (length(idempotency_key) BETWEEN 1 AND 512)
);

CREATE TABLE IF NOT EXISTS control_api_audit (
  audit_sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  correlation_id text NOT NULL,
  principal_id text NOT NULL,
  principal_kind text NOT NULL CHECK (principal_kind IN ('anonymous', 'user', 'workload', 'integration', 'operator')),
  action text NOT NULL CHECK (action IN (
    'project:read', 'dispatch:create', 'dispatch:cancel', 'run:publish',
    'run:readPublished', 'policy:read', 'policy:admin', 'membership:admin',
    'deletion:request', 'usage:read'
  )),
  tenant_id text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('authorization', 'operation')),
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied', 'succeeded', 'failed')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  grant_id text,
  policy_revision text,
  CHECK (length(correlation_id) BETWEEN 1 AND 256),
  CHECK (length(principal_id) BETWEEN 1 AND 256),
  CHECK (length(tenant_id) BETWEEN 1 AND 256),
  CHECK (length(resource_type) BETWEEN 1 AND 64),
  CHECK (length(resource_id) BETWEEN 1 AND 256)
);

CREATE INDEX IF NOT EXISTS control_api_audit_tenant_time
  ON control_api_audit (tenant_id, occurred_at, audit_sequence);
