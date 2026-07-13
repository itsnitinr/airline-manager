"use client";

import dynamic from "next/dynamic";
import { AirportSelectionList } from "./airport-selection-list";
import type { AirportMapProps } from "./types";
import styles from "./airport-map.module.css";

const DeferredAirportMapCanvas = dynamic(
  () => import("./airport-map.client").then(({ AirportMapCanvas }) => AirportMapCanvas),
  {
    ssr: false,
    loading: () => (
      <div className={styles.loadingState} role="status">
        Loading map renderer.
      </div>
    ),
  },
);

export type { AirportMapAirport, AirportMapProps } from "./types";

export function AirportMap({
  airports,
  selectedAirportId,
  onSelect,
  interactive = true,
  label = "Airport network map",
  styleUrl: configuredStyleUrl,
}: AirportMapProps) {
  const canSelect = interactive && onSelect !== undefined;
  const styleUrl =
    configuredStyleUrl ?? (process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim() || undefined);

  return (
    <section className={styles.mapModule} aria-label={label} data-testid="airport-map">
      <DeferredAirportMapCanvas
        airports={airports}
        {...(selectedAirportId === undefined ? {} : { selectedAirportId })}
        interactive={canSelect}
        label={label}
        {...(onSelect === undefined ? {} : { onSelect })}
        {...(styleUrl === undefined ? {} : { styleUrl })}
      />
      {canSelect ? (
        <AirportSelectionList
          airports={airports}
          {...(selectedAirportId === undefined ? {} : { selectedAirportId })}
          label="Select airport"
          onSelect={onSelect}
        />
      ) : null}
      <p className={styles.attribution}>
        Airport data from the published catalog. Map rendering by{" "}
        <a href="https://maplibre.org/" rel="noopener noreferrer" target="_blank">
          MapLibre
        </a>
        .
      </p>
    </section>
  );
}
