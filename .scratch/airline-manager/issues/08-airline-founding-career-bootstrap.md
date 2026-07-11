# Implement airline founding and career bootstrap

Type: task
Status: resolved
Blocked by: 05, 06, 07

## Goal

Allow an authenticated player to create a valid career airline and receive the
financial and world state required to choose a founder aircraft lease.

## Scope

- Create game-world, career, airline, ownership, home-jurisdiction, principal-
  base, reporting-currency, brand, and career-status models.
- Bind each career to immutable catalog and world-ruleset versions.
- Validate fictional airline identity and selected principal base.
- Post standardized founder equity through the ledger.
- Offer and optionally accept the modest founding loan with a deterministic
  repayment schedule.
- Create initial station presence at the principal base using outsourced
  services only.
- Forecast initial cash runway before final confirmation.
- Keep player account history distinct from airline insolvency or closure.

## Out of scope

- Founder aircraft selection, implemented in ticket 09.
- Additional bases or station investments.
- Multiple simultaneous airlines per player in slice one.

## Acceptance criteria

- Founding is atomic: partial airline, station, or ledger state cannot remain on
  failure.
- An account cannot found a second active slice-one airline.
- Founder equity and optional loan reconcile to cash and liabilities.
- Career state records the exact catalog and world-ruleset versions.
- The API returns an explainable runway forecast and the next required step.

## References

- ADR-0007: Career-first airline-level failure.
- ADR-0023: Home jurisdiction and simplified traffic rights.
- ADR-0025: Founder equity and capability-based credit.
- ADR-0032: One economic ruleset.

## Comments

- 2026-07-11: Implemented version-bound game-world, career, airline, fictional identity,
  home-jurisdiction, principal-base, outsourced-station, ownership, accounting-book, founder-
  financing, optional-loan, and exact deterministic repayment-schedule models. Founding is one
  serializable, idempotent transaction using ticket 06 ownership and ticket 07 ledger/outbox
  foundations, with PostgreSQL one-active-career enforcement and retained closed-career history.
  Added authenticated preview, confirm, owned summary, and next-step APIs. The versioned runway
  forecast includes administration, outsourced-station baseline, and selected loan repayments while
  explicitly excluding all ticket 09 aircraft/lease and later operating inputs.
- Validation passed frozen install, formatting, lint and eight boundary probes, OpenAPI/client
  freshness, type-check, unit/property tests, production build, blank/repeat/current PostgreSQL
  migrations, generated-type freshness, 46 real-PostgreSQL integration tests, and 11 authenticated
  API integration tests. Coverage includes every material-stage rollback, concurrent idempotency and
  one-active enforcement, ownership isolation, catalog/ruleset/base denials, immutable bindings,
  station/outbox creation, exact equity/loan/report reconciliation, deterministic schedules, safe
  errors, Compose validation, all three production images, ignored-file review, whitespace checks,
  and clean ticket-diff plus Git-history Gitleaks scans.
