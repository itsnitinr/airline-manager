# Scaffold the TypeScript monorepo

Type: task
Status: open
Blocked by: none

## Goal

Create the production repository structure for the separately deployable web,
API, and worker applications plus shared packages.

## Scope

- Configure a pinned Node.js version, package manager, workspace, and lockfile.
- Create `apps/web`, `apps/api`, and `apps/worker` entry points.
- Create packages for domain logic, API contracts, database adapters,
  configuration, and test support.
- Configure strict TypeScript, linting, formatting, unit tests, and workspace
  build/type-check scripts.
- Enforce dependency direction so apps may consume packages while domain code
  cannot import web, Fastify, BullMQ, or database adapters.
- Add a public-safe `.env.example` containing names and descriptions only.
- Document setup, common commands, and repository layout in the README.

## Out of scope

- Domain tables and migrations.
- Authentication or gameplay behavior.
- Production hosting-provider configuration.

## Acceptance criteria

- A clean checkout can install dependencies from the committed lockfile.
- Workspace build, type-check, lint, and unit-test commands pass.
- Each app starts with a minimal placeholder or health entry point.
- Dependency-boundary checks fail on a deliberate forbidden import.
- No secret or machine-specific value is committed.

## References

- ADR-0035: TypeScript monorepo with separate API and workers.
- ADR-0037: Modular monolith backend.
- ADR-0049: Containerized provider-neutral deployment.

## Comments

None yet.
