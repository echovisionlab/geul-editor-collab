# syntax=docker/dockerfile:1.27.1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e

FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
ARG PNPM_VERSION=12.9.1
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
RUN pnpm fetch

FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS package-manifests
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

FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --link --from=builder /app/dist ./dist
COPY --link --from=prod-deps /app/node_modules ./node_modules
COPY --link package.json ./package.json
EXPOSE 3003 3004
CMD ["node", "dist/index.js"]
