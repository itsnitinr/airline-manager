"use client";

import { MagnifyingGlass } from "@phosphor-icons/react";
import { useDeferredValue, useMemo, useState } from "react";
import { AirportMap } from "../map/airport-map";

export type SelectableAirport = Readonly<{
  id: string;
  iataCode: string;
  name: string;
  municipality: string;
  countryCode: string;
  latitudeDeg: string;
  longitudeDeg: string;
  longestRunwayFt: number;
}>;

export function AirportSelector({
  airports,
  selectedId,
  onSelect,
}: {
  airports: readonly SelectableAirport[];
  selectedId?: string | undefined;
  onSelect: (airport: SelectableAirport) => void;
}) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim().toLocaleLowerCase());
  const filtered = useMemo(() => {
    if (!deferred) return airports.slice(0, 30);
    return airports
      .filter((airport) =>
        `${airport.iataCode} ${airport.name} ${airport.municipality} ${airport.countryCode}`
          .toLocaleLowerCase()
          .includes(deferred),
      )
      .slice(0, 40);
  }, [airports, deferred]);
  const selected = airports.find((airport) => airport.id === selectedId);
  return (
    <div className="airport-picker">
      <div className="airport-map-slot">
        <AirportMap
          airports={airports}
          {...(selectedId ? { selectedAirportId: selectedId } : {})}
          onSelect={(id) => {
            const airport = airports.find((item) => item.id === id);
            if (airport) onSelect(airport);
          }}
          interactive
          label="Published airport map"
        />
      </div>
      <div className="airport-list-panel">
        <label className="search-field" htmlFor="airport-search">
          <MagnifyingGlass aria-hidden size={18} />
          <span className="sr-only">Search airports</span>
          <input
            id="airport-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search city, airport, or IATA"
            autoComplete="off"
          />
        </label>
        {selected ? (
          <div className="selected-airport" aria-live="polite">
            <span>Selected base</span>
            <strong>
              {selected.iataCode} {selected.name}
            </strong>
            <small>
              {selected.municipality}, {selected.countryCode} | longest runway{" "}
              {selected.longestRunwayFt.toLocaleString()} ft
            </small>
          </div>
        ) : null}
        <div
          className="airport-results"
          role="listbox"
          aria-label="Playable airports"
          aria-activedescendant={selectedId ? `airport-${selectedId}` : undefined}
        >
          {filtered.length ? (
            filtered.map((airport) => (
              <button
                key={airport.id}
                id={`airport-${airport.id}`}
                type="button"
                role="option"
                aria-selected={airport.id === selectedId}
                onClick={() => onSelect(airport)}
              >
                <span className="airport-code">{airport.iataCode}</span>
                <span>
                  <strong>{airport.name}</strong>
                  <small>
                    {airport.municipality}, {airport.countryCode}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p className="empty-inline">No published airport matches that search.</p>
          )}
        </div>
      </div>
    </div>
  );
}
