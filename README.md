# Geul Editor Collab

Standalone collaborative editor service for Geul.

## Requirements

- Node.js `24.19.0`
- pnpm `11.22.0`
- PostgreSQL with the collaboration schema and PGMQ queue

All package dependencies are installed from the public npm registry. No GitHub
token is required for local or CI dependency installation.

## Development

```bash
pnpm install --frozen-lockfile
pnpm dev
```

The WebSocket listener uses `PORT` (default `3003`) and the internal health and
relay listener uses `HEALTH_PORT` (default `3004`). `SITE_ORIGIN` must exactly
match the browser origin. `TOKEN_SIGNING_SECRET` is required for trusted
service-to-service requests.
`MANAGED_MEDIA_ORIGINS` is a comma-separated list of absolute HTTP(S) origins
owned by the media service; managed media paths on those origins are rejected
from collaboration state.

The Compose example maps deployment variables with the `GEUL_` prefix:

```bash
GEUL_COLLAB_IMAGE=registry.dsub.io/echovisionlab/geul-editor-collab:v0.1.0 \
GEUL_COLLAB_DATABASE_DSN='postgres://...' \
GEUL_COLLAB_API_URL='https://api.example.com' \
GEUL_SITE_ORIGIN='https://app.example.com' \
GEUL_MANAGED_MEDIA_ORIGINS='https://media.example.com,http://localhost:3000' \
GEUL_BACKEND_TOKEN_SIGNING_SECRET='...' \
GEUL_OTEL_EXPORTER_OTLP_ENDPOINT='https://otel.example.com:4318' \
docker compose -f compose/collab.yml up -d
```

## Collaboration contract

Room names, WebSocket framing, generated protobuf JSON, Yjs bootstrap/update
semantics, revision and hash tokens, document layout keys, and durable database
fields remain compatible with the editor and owning APIs. Yjs is transient
collaboration state; the owning API remains the durable authority. A restart,
state-vector mismatch, or revision conflict returns `reload_required` and the
client must bootstrap a fresh document.

Authentication accepts the canonical session injected by the trusted gateway,
checks the owning API before each inbound frame, and never persists the session
identifier to awareness, Yjs, or collaboration logs. `VIEW` connections receive
canonical sync and presence without mutation or persistence.

## Validation

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm unused
pnpm test:coverage
pnpm test:ci-scripts
pnpm build
pnpm smoke:release-syntax
pnpm smoke:release-dependencies
```

When the sibling public Geul packages are checked out, also run:

```bash
pnpm typecheck:local-dependencies
pnpm test:local-dependencies
pnpm build:local-dependencies
```

## Release

Release Please creates versioned releases from `main`. The release workflow
uses GitHub-hosted `ubuntu-latest` runners and `${{ github.token }}`. On a
release tag it publishes the exact release SHA and version tags for
`registry.dsub.io/echovisionlab/geul-editor-collab`; it does not deploy a
cluster.

See [LICENSE](LICENSE) for the PolyForm Noncommercial 1.0.0 terms.
