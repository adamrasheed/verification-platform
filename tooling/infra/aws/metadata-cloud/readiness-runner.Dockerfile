FROM node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90 AS build

WORKDIR /app

COPY . .

RUN npm ci --ignore-scripts \
  && npm run build \
  && npm prune --omit=dev --ignore-scripts \
  && rm -rf /root/.npm

FROM postgres:17.9-bookworm@sha256:3a69b9de644363f30110fbaa78b9e3298ce71bb1aa9124c0b0ceb0a2602c3283 AS runtime

WORKDIR /app

COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build --chown=postgres:postgres /app/node_modules ./node_modules
COPY --from=build --chown=postgres:postgres /app/packages ./packages
COPY --from=build --chown=postgres:postgres /app/apps/control-api/package.json ./apps/control-api/package.json
COPY --from=build --chown=postgres:postgres /app/apps/control-api/dist ./apps/control-api/dist
COPY --from=build --chown=postgres:postgres /app/apps/control-api/migrations ./apps/control-api/migrations
COPY --from=build --chown=postgres:postgres /app/tooling/infra/control-api-node-http.mjs ./tooling/infra/control-api-node-http.mjs
COPY --from=build --chown=postgres:postgres /app/tooling/infra/production-readiness-contract.mjs ./tooling/infra/production-readiness-contract.mjs
COPY --from=build --chown=postgres:postgres /app/tooling/infra/run-live-production-readiness.mjs ./tooling/infra/run-live-production-readiness.mjs
COPY --chown=postgres:postgres tooling/infra/aws/metadata-cloud/us-west-2-bundle.pem /app/rds-ca-bundle.pem

RUN mkdir /work && chown postgres:postgres /work
VOLUME ["/work"]

USER postgres
ENTRYPOINT []
CMD ["node", "tooling/infra/run-live-production-readiness.mjs"]
