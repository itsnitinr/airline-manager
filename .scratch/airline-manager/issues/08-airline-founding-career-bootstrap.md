# Implement airline founding and career bootstrap

Type: task
Status: open
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

None yet.
