# Reference-data catalog

Slice one publishes 250 curated passenger airports and exactly four passenger aircraft variants:
ATR 72-600 (turboprop), Embraer E175 (regional jet), Airbus A320neo, and Boeing 737-8
(narrow-bodies). These choices cover short regional operations through familiar medium-range
single-aisle strategies without introducing cargo or freighter content.

## Sources and use boundaries

- OurAirports airport and runway CSV data is public domain. Its publisher does not guarantee
  accuracy and explicitly warns against flight-planning use. Raw rows remain quarantined until
  validation and explicit promotion. The checked fixture contains only the 250 reviewed output
  rows, not the large upstream dumps.
- IANA tzdb 2026b supplies the versioned timezone identifier set. Coordinate-to-zone assignment is
  a derived lookup using `tz-lookup` / Timezone Boundary Builder data (ODbL 1.0), then checked
  against IANA `zone.tab`. The resulting field records both sources and the mapping formula version.
- Aircraft identity, capacity, range, weight, and current product status are factual citations from
  ATR, Embraer, Airbus, and Boeing public manufacturer pages. FAA certification publications support
  regulated variant identity through TCDS A53EU, A56NM, A28NM, and A16WE. No manuals, proprietary databases, or copyrighted publications are
  copied into the repository.
- Minimum-runway envelopes for the E175, A320neo, and 737-8 are conservative derived simulation
  values (`aircraft-envelope-v1`), not certified takeoff-distance claims. ATR's published MTOW/ISA/
  sea-level figure is retained as sourced. Acquisition channels are gameplay rules, not market facts.

Source URLs, license/use labels, attribution, accuracy boundaries, checksums, versions, and retrieval
times are persisted in the source registry and raw-import manifests. Manufacturer facts are cited;
the source pages themselves are not redistributed.

## Explicit update and publication flow

Network access is limited to the explicit `catalog:fetch` command, which writes ignored files under
`.data/reference-imports`. Deterministic generation uses pinned local inputs:

```sh
pnpm --filter @airline-manager/database catalog:fetch
pnpm --filter @airline-manager/database catalog:fixture \
  .data/reference-imports/airports.csv .data/reference-imports/runways.csv \
  .data/reference-imports/tzdata/zone.tab packages/database/data/slice-one-airports.json
```

`catalog:seed` imports the checked fixture into quarantine, validates it, explicitly promotes valid
rows, creates a draft snapshot, verifies field provenance and slice composition, publishes the
immutable release, and creates its versioned world ruleset. It never promotes an arbitrary upstream
row and is deliberately separate from `catalog:fetch`; there is no automated publication path.
Once activated, the ruleset and its acquisition overrides are immutable just like the selected
catalog release.
