import type { AirportMapAirport } from "./types";
import styles from "./airport-map.module.css";

type AirportSelectionListProps = Readonly<{
  airports: readonly AirportMapAirport[];
  selectedAirportId?: string;
  label: string;
  onSelect(airportId: string): void;
}>;

export function AirportSelectionList({
  airports,
  selectedAirportId,
  label,
  onSelect,
}: AirportSelectionListProps) {
  const sortedAirports = airports.toSorted((left, right) =>
    left.iataCode.localeCompare(right.iataCode),
  );

  return (
    <div className={styles.selectionControl}>
      <label htmlFor="airport-map-selection">{label}</label>
      <select
        id="airport-map-selection"
        value={selectedAirportId ?? ""}
        onChange={(event) => onSelect(event.currentTarget.value)}
      >
        <option value="" disabled>
          Choose an airport
        </option>
        {sortedAirports.map((airport) => (
          <option key={airport.id} value={airport.id}>
            {airport.iataCode} - {airport.name}
          </option>
        ))}
      </select>
      <p>Map and list selections stay synchronized.</p>
    </div>
  );
}
