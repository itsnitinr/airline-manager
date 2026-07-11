# ADR-0049: Keep deployment containerized and provider-neutral

Status: accepted

## Context

The product contains independently running web, API, and simulation workers plus
PostgreSQL and Redis. A serverless-only design would not fit stable background
processing, while selecting a production vendor before usage, budget, and
operating requirements are known would create premature coupling.

## Decision

Docker Compose will run the complete topology for local development. API and
worker applications ship as production-ready containers. The Next.js web app
deploys independently. Production may use managed PostgreSQL and Redis.

Infrastructure configuration remains provider-neutral where practical, and the
specific hosting provider is deferred until launch planning. A serverless-only
backend architecture is excluded.

## Consequences

- Local development can exercise real queue, database, API, and worker behavior.
- Container health checks, graceful shutdown, migrations, and worker draining
  are required.
- Production needs persistent worker compute in addition to the web deployment.
- Provider-specific integrations must remain infrastructure adapters rather
  than domain dependencies.
