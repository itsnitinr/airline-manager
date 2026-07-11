# Establish local infrastructure and CI quality gates

Type: task
Status: resolved
Blocked by: 01

## Goal

Make the complete local topology reproducible and establish the baseline checks
that every later ticket must satisfy.

## Scope

- Add Dockerfiles for the API and worker and a development container strategy
  for the web application.
- Add Docker Compose services for web, API, worker, PostgreSQL, and Redis.
- Add health checks, named local volumes, graceful shutdown, and documented
  reset/reseed commands.
- Keep credentials in environment variables and commit examples only.
- Add CI jobs for install, formatting, lint, type-check, unit tests, build, and
  secret scanning.
- Cache dependencies without caching environment files or generated secrets.
- Verify that ignored local database and container state stays untracked.

## Out of scope

- Selecting a production hosting provider.
- Applying the gameplay schema.
- Full integration and browser suites, which arrive in ticket 23.

## Acceptance criteria

- `docker compose up` starts the topology from a clean checkout.
- API and worker readiness checks fail when required PostgreSQL or Redis
  connectivity is unavailable and recover when dependencies return.
- CI runs on pull requests and the default branch.
- CI never prints database passwords, OAuth secrets, or session material.
- Shutting down the stack drains processes without corrupting local state.

## References

- ADR-0049: Containerized provider-neutral deployment.
- ADR-0052: Observability from the first slice.

## Comments

- 2026-07-11: Added non-root production API and worker images, a Compose Watch web
  development image, and the complete web/API/worker/PostgreSQL/Redis topology with
  dependency-aware readiness, health-gated startup, named volumes, graceful shutdown,
  local-only environment defaults, and documented up/down/reset/reseed workflows. Added
  pull-request/main CI for frozen install, formatting, lint and boundary enforcement,
  type-checking, 14 unit tests, build, container validation, and redacted history secret
  scanning with a pnpm-store-only cache. Validation passed for all local quality gates,
  Compose configuration, current API/worker/web image builds, clean stack startup,
  reset/reseed, independent PostgreSQL and Redis outage/recovery for both API and worker,
  zero-exit SIGTERM shutdown and retained volumes, ignored local state, trackable-file and
  history secret scans, and runtime image/context inspection. The live stack used supported
  host-port overrides because unrelated local Next.js processes occupied ports 3000/3001;
  committed defaults and container-internal ports remain unchanged.
