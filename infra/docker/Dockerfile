# SENT — one image, five services.
#
# The services share a workspace and a lockfile, so building them separately
# would mean five resolutions of the same dependency graph and five chances for
# them to differ. SERVICE selects the entry point at run time instead.
#
# Node runs the TypeScript directly via --experimental-strip-types. There is no
# build step and therefore no compiled output that can disagree with the source
# it was built from — which is the same reason the repo has no dist/ anywhere.

FROM node:22-alpine AS base

# pnpm is pinned by the workspace's packageManager field. Corepack reads it, so
# the version in the image is the version in the repo, not whatever is current.
RUN corepack enable

WORKDIR /app

# Manifests first. They change far less often than source, so the dependency
# layer survives most rebuilds.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/config/package.json          packages/config/
COPY packages/contracts/package.json       packages/contracts/
COPY packages/database/package.json        packages/database/
COPY packages/economics/package.json       packages/economics/
COPY packages/realtime/package.json        packages/realtime/
COPY packages/sdk/package.json             packages/sdk/
COPY packages/stockback/package.json       packages/stockback/
COPY services/api/package.json             services/api/
COPY services/finalizer/package.json       services/finalizer/
COPY services/indexer/package.json         services/indexer/
COPY services/realtime/package.json        services/realtime/
COPY services/stockback/package.json       services/stockback/
COPY services/worker/package.json          services/worker/

RUN pnpm install --frozen-lockfile

COPY packages/ packages/
COPY services/ services/

# Never root. A container that only reads a database and speaks HTTP has no
# reason to be able to write to its own filesystem as root.
USER node

# Selected at run time. Compose sets it per service.
ENV SERVICE=api

# Exec form via sh because SERVICE needs expanding; `exec` keeps node as PID 1 so
# SIGTERM reaches it and the shutdown handlers actually run.
CMD ["sh", "-c", "exec node --experimental-strip-types services/${SERVICE}/src/main.ts"]
