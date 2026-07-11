# Establish local infrastructure and CI quality gates

Type: task
Status: open
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

None yet.
