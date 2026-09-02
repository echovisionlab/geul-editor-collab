# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

FROM node:24.19.0-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS base
ARG PNPM_VERSION=11.22.0
ENV PNPM_HOME=/pnpm
ENV PNPM_STORE_DIR=/pnpm/store
ENV PATH=${PNPM_HOME}:${PATH}
ENV HUSKY=0
RUN apk add --no-cache bash git \
    && corepack enable pnpm \
    && corepack prepare pnpm@${PNPM_VERSION} --activate \
    && pnpm config set store-dir ${PNPM_STORE_DIR}

FROM base AS fetched-deps
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
RUN pnpm fetch --frozen-lockfile

FROM node:24.19.0-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS package-manifests
WORKDIR /app
COPY package.json ./package.source.json
COPY scripts/ci/docker-package-manifests.mjs ./scripts/ci/docker-package-manifests.mjs
RUN node ./scripts/ci/docker-package-manifests.mjs \
    ./package.source.json ./package.dependencies.json ./package.build.json

FROM base AS deps
WORKDIR /app
COPY --from=fetched-deps /pnpm/store /pnpm/store
COPY --from=package-manifests /app/package.dependencies.json ./package.json
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --offline --trust-lockfile

FROM deps AS prod-deps
RUN pnpm prune --prod

FROM deps AS builder
WORKDIR /app
COPY --from=package-manifests /app/package.build.json ./package.json
COPY tsconfig.json tsup.config.ts ./
COPY index.ts env.ts ./
COPY events ./events
COPY handlers ./handlers
COPY lib ./lib
RUN pnpm typecheck
RUN pnpm build

FROM node:24.19.0-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --link --from=builder /app/dist ./dist
COPY --link --from=prod-deps /app/node_modules ./node_modules
COPY --link package.json ./package.json
EXPOSE 3003 3004
CMD ["node", "dist/index.js"]
