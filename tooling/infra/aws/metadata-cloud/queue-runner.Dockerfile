FROM node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90 AS build

WORKDIR /app

COPY . .

RUN npm ci --ignore-scripts \
  && npm run build --workspace @verify-internal/contracts \
  && npm run build --workspace @verify-internal/events \
  && npm run build --workspace @verify-internal/protocol \
  && npm run build --workspace @verify-internal/cloud-client \
  && npm prune --omit=dev --ignore-scripts \
  && rm -rf /root/.npm

FROM node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90 AS runtime

WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/events/package.json ./packages/events/package.json
COPY --from=build --chown=node:node /app/packages/events/dist ./packages/events/dist
COPY --from=build --chown=node:node /app/packages/protocol/package.json ./packages/protocol/package.json
COPY --from=build --chown=node:node /app/packages/protocol/dist ./packages/protocol/dist
COPY --from=build --chown=node:node /app/packages/cloud-client/package.json ./packages/cloud-client/package.json
COPY --from=build --chown=node:node /app/packages/cloud-client/dist ./packages/cloud-client/dist
COPY --from=build --chown=node:node /app/packages/cloud-client/migrations ./packages/cloud-client/migrations
COPY --from=build --chown=node:node /app/tooling/infra/aws-sqs-publication-transport.mjs ./tooling/infra/aws-sqs-publication-transport.mjs
COPY --from=build --chown=node:node /app/tooling/infra/run-live-sqs-conformance.mjs ./tooling/infra/run-live-sqs-conformance.mjs
COPY --chown=node:node tooling/infra/aws/metadata-cloud/us-west-2-bundle.pem /app/rds-ca-bundle.pem

USER node

CMD ["node", "tooling/infra/run-live-sqs-conformance.mjs"]
