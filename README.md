# Airline Manager

Airline Manager is a production TypeScript monorepo with independently deployable web, API, and
simulation-worker applications. It includes PostgreSQL persistence, curated reference data, and a
Better Auth authentication adapter while intentionally deferring airline gameplay to later tickets.

## Prerequisites

- Node.js `24.18.0` (pinned in `.node-version`, `.nvmrc`, and `package.json`)
- pnpm `11.11.0` through Corepack (pinned by the `packageManager` field)

pnpm also records the Node runtime and checksum in the lockfile and uses that local runtime for
workspace scripts, so commands stay on Node 24.18.0 even when the host has another Node version.

```sh
corepack enable
pnpm install --frozen-lockfile
```

The committed `.env.example` contains public-safe local-only values and blank authentication secret
and OAuth fields. Before starting the API, copy it to `.env`, generate a local Better Auth secret
with `openssl rand -base64 32`, and assign that value to `BETTER_AUTH_SECRET`. `.env` and every
non-example environment file are ignored. Never reuse the example database password or generated
auth secret outside the local environment. See `docs/authentication.md` for authentication,
provider, cookie, email-capture, and ownership setup.

## Common commands

| Command                 | Purpose                                                  |
| ----------------------- | -------------------------------------------------------- |
| `pnpm dev`              | Start the web, API, and worker development processes     |
| `pnpm build`            | Build every application and shared package               |
| `pnpm typecheck`        | Run strict TypeScript checks across the workspace        |
| `pnpm lint`             | Run ESLint and dependency-boundary rules                 |
| `pnpm format`           | Format source and configuration files                    |
| `pnpm format:check`     | Verify formatting without changing files                 |
| `pnpm test`             | Run all unit tests                                       |
| `pnpm test:boundaries`  | Prove a forbidden domain-to-framework import is rejected |
| `pnpm db:migrate`       | Apply reviewed forward SQL migrations                    |
| `pnpm db:migrate:check` | Fail when migrations are pending or edited               |
| `pnpm db:types`         | Generate Kysely types from the applied schema            |
| `pnpm db:types:check`   | Verify committed database types are current              |
| `pnpm test:database`    | Run tests against real PostgreSQL                        |
| `pnpm infra:up`         | Build and start the complete local topology              |
| `pnpm infra:down`       | Gracefully stop it while preserving database state       |
| `pnpm infra:reset`      | Stop it and delete PostgreSQL and Redis volumes          |
| `pnpm infra:reseed`     | Reset and recreate the currently empty infrastructure    |

Individual applications can be started with filters, for example
`pnpm --filter @airline-manager/api dev`. The placeholder web application uses port 3000, while the
API defaults to port 3001 when no environment value is supplied. These are development fallbacks in
source code, not secret or machine-specific configuration.

## Repository layout

```text
apps/
  web/           Next.js browser application
  api/           backend HTTP process
  worker/        background simulation process
packages/
  domain/        deterministic, framework-independent domain logic
  contracts/     public API contract types
  database/      SQL migrations, generated types, identity, and persistence adapters
  config/        environment/configuration access
  test-support/  reusable deterministic test helpers
```

Applications may consume shared packages. The domain package is deliberately isolated from Next.js,
Fastify, BullMQ, database adapters, and application source. ESLint enforces those restrictions; the
web application is also prevented from importing persistence adapters directly.

Architecture and product decisions remain documented in `CONTEXT.md`, `docs/adr/`, and the local
ticket set under `.scratch/airline-manager/`.

## Local container topology

`compose.yaml` runs the web application, API, simulation worker, PostgreSQL, Redis, and a one-shot
forward migration service. From a clean checkout:

```sh
pnpm infra:up
```

The web app is available at `http://localhost:3000`, API liveness at `http://localhost:3001/health`,
API readiness at `http://localhost:3001/ready`, and worker readiness at
`http://localhost:3002/ready`. Liveness only proves that a process can respond. Readiness opens real
connections to both PostgreSQL and Redis and returns HTTP 503 if either required dependency is
unavailable. Compose waits for healthy data services before starting the applications.

PostgreSQL and Redis use the named `postgres-data` and `redis-data` volumes. A normal stop preserves
them and sends SIGTERM, allowing the API to drain HTTP connections, the worker to stop accepting
work, PostgreSQL to shut down cleanly, and Redis to flush its append-only state within the
configured grace periods:

```sh
pnpm infra:down
```

Use `pnpm infra:reset` to delete all local database and Redis state. `pnpm infra:reseed` performs
the same destructive reset and starts fresh services. There is intentionally no gameplay seed or
schema yet; later persistence tickets will extend that command rather than introducing migrations
here.

To verify dependency failure and recovery manually, stop one service, observe HTTP 503 from both
readiness endpoints, restart it, and wait for HTTP 200:

```sh
docker compose stop postgres
curl --fail-with-body http://localhost:3001/ready
curl --fail-with-body http://localhost:3002/ready
docker compose start postgres
until curl --fail-with-body http://localhost:3001/ready; do sleep 1; done
until curl --fail-with-body http://localhost:3002/ready; do sleep 1; done
```

Repeat with `redis` to verify the other required dependency. Readiness responses expose only up/down
status; connection URLs, passwords, and error details are never returned or logged.

### Web development container

The web service uses `apps/web/Dockerfile.dev`, deliberately separate from the production API and
worker images because ADR-0049 keeps the Next.js deployment independent. The image installs the
frozen workspace and runs the Next.js development server. Compose Watch syncs web and shared-package
source without bind-mounting host dependencies or machine state into the container:

```sh
docker compose up --build --watch
```

Dependency manifest changes trigger an image rebuild. Stop the watch session with Ctrl-C; Compose
uses the same graceful shutdown configuration as `pnpm infra:down`.

### Production application images

The API and worker Dockerfiles use the exact repository Node version, frozen installs, multi-stage
workspace builds, production-only deployed dependencies, a non-root runtime user, dependency-aware
health checks, and SIGTERM shutdown. They accept database and Redis connection URLs only at runtime:

```sh
docker build -f apps/api/Dockerfile -t airline-manager-api .
docker build -f apps/worker/Dockerfile -t airline-manager-worker .
```

No production hosting provider is selected by this setup.

## Continuous integration

`.github/workflows/ci.yml` runs for pull requests and pushes to `main`. It performs a frozen
install, format check, lint, type-check, unit tests, workspace build, Compose validation, API/worker
image builds, and a redacted full-history Gitleaks scan. The pnpm cache contains only pnpm's global
package store and is keyed from `pnpm-lock.yaml`; it does not cache the workspace, `node_modules`,
environment files, local volumes, or generated credentials. The workflow has read-only repository
permissions, defines no application secrets, and never prints environment values.
