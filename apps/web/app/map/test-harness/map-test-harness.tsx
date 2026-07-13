"use client";

import { useState } from "react";
import { AirportMap, type AirportMapAirport } from "../airport-map";

const publishedAirportSamples: readonly AirportMapAirport[] = [
  {
    id: "catalog-lhr",
    iataCode: "LHR",
    name: "London Heathrow Airport",
    latitudeDeg: "51.470748",
    longitudeDeg: "-0.459909",
  },
  {
    id: "catalog-jfk",
    iataCode: "JFK",
    name: "John F. Kennedy International Airport",
    latitudeDeg: "40.639447",
    longitudeDeg: "-73.779317",
  },
  {
    id: "catalog-sin",
    iataCode: "SIN",
    name: "Singapore Changi Airport",
    latitudeDeg: "1.35019",
    longitudeDeg: "103.994003",
  },
];

export function MapTestHarness() {
  const [selectedAirportId, setSelectedAirportId] = useState("catalog-lhr");
  return (
    <main style={{ maxWidth: "70rem", margin: "0 auto", padding: "2rem" }}>
      <h1>Map test harness</h1>
      <AirportMap
        airports={publishedAirportSamples}
        selectedAirportId={selectedAirportId}
        onSelect={setSelectedAirportId}
        label="Published airport selection map"
        styleUrl="/__map-style-failure__.json"
      />
      <output aria-live="polite">Selected airport: {selectedAirportId}</output>
    </main>
  );
}
