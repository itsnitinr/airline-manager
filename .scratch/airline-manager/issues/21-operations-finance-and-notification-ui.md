# Build live operations, finance, and notification views

Type: task
Status: open
Blocked by: 07, 10, 17, 18, 19

## Goal

Let the player understand current operations, offline outcomes, financial health,
and required recovery actions on desktop and mobile.

## Scope

- Build an operations dashboard for active/upcoming flights, aircraft status,
  delay/suspension reasons, shortages, and maintenance alerts.
- Display flight detail and immutable settlement breakdown with inputs,
  realized outcomes, and attributed costs/revenue.
- Build simplified cash, runway, obligations, route profitability, and fuel
  inventory views.
- Add advanced profit-and-loss, balance-sheet, cash-flow, and journal views.
- Build the persisted notification center, unread state, filters, action links,
  browser opt-in, severity preferences, and quiet hours.
- Reconcile SSE updates with authoritative query refresh and offline recovery.
- Provide mobile monitoring plus agreed safe fuel and simple-pricing actions.

## Out of scope

- Editing ledger history.
- Email notification preferences.
- Native push delivery.

## Acceptance criteria

- A player returning after an offline flight can understand what happened and
  how every displayed financial result reconciles.
- Live updates never replace or contradict the authoritative refreshed state.
- Suspension and failure states show bounded consequences and actionable recovery.
- Advanced statements balance to the ledger.
- Mobile views expose alerts and safe recovery actions with accessible controls.

## References

- ADR-0027: Ledger-derived financial reporting.
- ADR-0031: Bounded offline failure.
- ADR-0036: Recoverable SSE.
- ADR-0047: Notification channels.

## Comments

None yet.
