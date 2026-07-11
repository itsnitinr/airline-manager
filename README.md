# Airline Manager

Airline Manager is a production TypeScript monorepo with independently deployable web, API, and
simulation-worker applications. This foundation intentionally contains no gameplay, authentication,
database schema, migrations, or production-provider configuration.

## Prerequisites

- Node.js `24.18.0` (pinned in `.node-version`, `.nvmrc`, and `package.json`)
- pnpm `11.11.0` through Corepack (pinned by the `packageManager` field)

pnpm also records the Node runtime and checksum in the lockfile and uses that local runtime for
workspace scripts, so commands stay on Node 24.18.0 even when the host has another Node version.

```sh
corepack enable
pnpm install --frozen-lockfile
```

Copy `.env.example` to `.env` only when local services are introduced. The committed example lists
variable names and descriptions but deliberately contains no values.

## Common commands

| Command                | Purpose                                                  |
| ---------------------- | -------------------------------------------------------- |
| `pnpm dev`             | Start the web, API, and worker development processes     |
| `pnpm build`           | Build every application and shared package               |
| `pnpm typecheck`       | Run strict TypeScript checks across the workspace        |
| `pnpm lint`            | Run ESLint and dependency-boundary rules                 |
| `pnpm format`          | Format source and configuration files                    |
| `pnpm format:check`    | Verify formatting without changing files                 |
| `pnpm test`            | Run all unit tests                                       |
| `pnpm test:boundaries` | Prove a forbidden domain-to-framework import is rejected |

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
  database/      persistence adapter interfaces and future implementations
  config/        environment/configuration access
  test-support/  reusable deterministic test helpers
```

Applications may consume shared packages. The domain package is deliberately isolated from Next.js,
Fastify, BullMQ, database adapters, and application source. ESLint enforces those restrictions; the
web application is also prevented from importing persistence adapters directly.

Architecture and product decisions remain documented in `CONTEXT.md`, `docs/adr/`, and the local
ticket set under `.scratch/airline-manager/`.
