FROM node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90 AS build

WORKDIR /app

COPY . .

RUN npm ci --ignore-scripts \
  && npm run build \
  && npm prune --omit=dev --ignore-scripts \
  && rm -rf /root/.npm

FROM node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90 AS runtime

WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/github-action/package.json ./apps/github-action/package.json
COPY --from=build --chown=node:node /app/apps/github-action/lib ./apps/github-action/lib
COPY --from=build --chown=node:node /app/apps/control-api/package.json ./apps/control-api/package.json
COPY --from=build --chown=node:node /app/apps/control-api/dist ./apps/control-api/dist
COPY --from=build --chown=node:node /app/apps/control-api/migrations ./apps/control-api/migrations
COPY --from=build --chown=node:node /app/tooling/corpus/npm-valid ./tooling/corpus/npm-valid
COPY --from=build --chown=node:node /app/tooling/infra/control-api-node-http.mjs ./tooling/infra/control-api-node-http.mjs
COPY --from=build --chown=node:node /app/tooling/infra/run-live-customer-workload-conformance.mjs ./tooling/infra/run-live-customer-workload-conformance.mjs
COPY --chown=node:node tooling/infra/aws/metadata-cloud/us-west-2-bundle.pem /app/rds-ca-bundle.pem

RUN mkdir /work && chown node:node /work
VOLUME ["/work"]

USER node

CMD ["node", "tooling/infra/run-live-customer-workload-conformance.mjs"]
