# ADR-0053: Keep aircraft age real-time and drive wear through utilization

Status: accepted

## Context

Flight operations run at approximately 1:1 real time, while long strategic
contracts use compressed gameplay terms. Accelerating chronological aircraft
age would make a newly delivered aircraft become implausibly old within weeks
and conflict with factual age displayed for used aircraft.

Keeping every aging-related consequence on literal multi-year timelines would
make fleet condition and renewal irrelevant during ordinary play.

## Decision

Aircraft chronological age advances with real calendar time. Used aircraft enter
with pre-existing age, hours, cycles, condition, and maintenance history.

Ongoing wear and replacement pressure derive primarily from operational hours,
cycles, condition, dispatch reliability, maintenance burden, and economics.
Calendar-driven maintenance uses explicit, balanced real-day thresholds rather
than a globally accelerated fictional calendar.

## Consequences

- Displayed manufacturing and chronological age remain coherent.
- High utilization can make a relatively young aircraft expensive or unreliable
  without pretending it aged several years overnight.
- Used-market generation supplies meaningful age diversity from the start.
- Calendar thresholds must be labeled as gameplay-compressed maintenance rules
  when they differ from literal operator programs.
