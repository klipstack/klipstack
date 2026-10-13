# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate
WORKDIR /app

FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
# Patched dependencies (pnpm-workspace.yaml): pnpm needs every patch, even for packages it skips.
COPY patches/ patches/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/ai/package.json packages/ai/
COPY packages/db/package.json packages/db/
COPY packages/email/package.json packages/email/
COPY packages/i18n/package.json packages/i18n/
COPY packages/queue/package.json packages/queue/
COPY packages/extract/package.json packages/extract/
COPY packages/anchor/package.json packages/anchor/
COPY packages/storage/package.json packages/storage/
COPY packages/log/package.json packages/log/
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/sdk/package.json packages/sdk/

FROM manifests AS deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store NODE_ENV=development pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @klipstack/web build

FROM manifests AS runtime
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile
COPY --from=build /app/apps/web/build apps/web/build
COPY apps/web/server.js apps/web/security-middleware.js apps/web/
# The operator's CLI (`pnpm --filter @klipstack/web admin`) and the modules it imports. It is the
# only way to grant or revoke the admin role or delete someone's account, so the image must run it.
COPY apps/web/scripts/admin.ts apps/web/scripts/
COPY apps/web/app/services/admin-roles.server.ts apps/web/app/services/admin-audit.server.ts \
	apps/web/app/services/admin-accounts.server.ts apps/web/app/services/account.server.ts \
	apps/web/app/services/
COPY apps/web/app/lib/app-error.ts apps/web/app/lib/
COPY apps/worker/src apps/worker/src
COPY apps/worker/scripts apps/worker/scripts
COPY packages packages
COPY tsconfig.base.json ./
# The role CLI is copied file by file above: an import added later and not copied would break it
# only in production. Loading it here (usage error, exit 2, no database connection) fails the build.
RUN cd apps/web && DATABASE_URL=postgres://build:build@127.0.0.1:1/build ./node_modules/.bin/tsx scripts/admin.ts \
	; test $? -eq 2
# The app writes only to local image storage. Its code stays root's: a recursive chown would copy
# every file into another layer, and would let the app user rewrite the code it runs.
RUN mkdir -p /app/storage && chown node:node /app/storage
# The deployed commit: shown in Settings, and how the app knows a newer one is live.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
EXPOSE 3000
ENV PORT=3000
# Node itself is PID 1, so docker stop's SIGTERM reaches server.js (pnpm's shell would not pass it on).
WORKDIR /app/apps/web
USER node
CMD ["node", "server.js"]
