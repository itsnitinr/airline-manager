# Airline founding and career bootstrap

Ticket 08 establishes the first persistent airline boundary without creating an aircraft or accepting
a founder-aircraft lease.

## Published version binding

Every career stores immutable foreign-key bindings to its game world, published catalog release,
active world ruleset, and founding-balance version. The balance version is seeded from the checked-in
`founding-balance-v1.json` fixture and owns founder equity, optional-loan limits and terms, baseline
obligations, and forecast assumptions. Existing careers never silently move to later versions.

The player account remains a separate identity and history boundary. A partial unique PostgreSQL
index permits one active slice-one career per player account, while a closed or insolvent career does
not delete the account or its historical airline ownership.

## Atomic confirmation

`POST /v1/airlines/founding/confirm` requires a verified domain player account and an idempotency key.
One serializable PostgreSQL transaction creates the career, airline, outsourced principal-base
station, financing selection, optional loan and schedule, opaque ownership binding, accounting book
and period, founder-equity and loan journals, and transactional outbox events. Any failure rolls back
the complete transition. Replaying the same key and request returns the original response; reusing a
key with different input is rejected.

Founder equity posts as a debit to cash and credit to owner equity. Accepted loan proceeds post as a
debit to cash and credit to loans payable. All amounts are exact ISO minor-unit integers. Loan
interest uses exact integer rational arithmetic with half-even rounding and deterministic real-day
due dates.

## Pre-aircraft runway forecast

`POST /v1/airlines/founding/preview` returns the selected equity, optional loan terms and schedule,
and a cash-runway forecast before confirmation. The versioned forecast includes only:

- the corporate-administration baseline;
- the outsourced principal-base station baseline; and
- exact scheduled founding-loan repayments when selected.

It explicitly excludes aircraft lease payments, fuel, maintenance, aircraft workforce,
route-specific airport costs, and flight revenue. Those inputs do not exist until ticket 09 and later
operating tickets, so the forecast does not invent aircraft-specific costs.

Owned `GET /v1/airlines/:airlineId` and `GET /v1/airlines/:airlineId/next-step` queries report the
ledger-backed summary and identify `select_founder_aircraft` as the next step. Missing and foreign
airline identifiers receive the same ownership denial.
