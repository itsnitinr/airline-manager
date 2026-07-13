import { describe, expect, it } from "vitest";
import { airportFeatureCollection, noTileDarkStyle } from "./maplibre-adapter";
import type { AirportMapAirport } from "./types";

const airports: readonly AirportMapAirport[] = [
  {
    id: "lhr",
    iataCode: "LHR",
    name: "London Heathrow Airport",
    latitudeDeg: "51.470748",
    longitudeDeg: "-0.459909",
  },
  {
    id: "invalid",
    iataCode: "INV",
    name: "Invalid coordinate fixture",
    latitudeDeg: "91",
    longitudeDeg: "0",
  },
];

describe("MapLibre airport adapter data", () => {
  it("builds deterministic GeoJSON from valid published coordinates", () => {
    expect(airportFeatureCollection(airports, "lhr")).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "lhr",
          geometry: { type: "Point", coordinates: [-0.459909, 51.470748] },
          properties: {
            airportId: "lhr",
            iataCode: "LHR",
            name: "London Heathrow Airport",
            selected: true,
          },
        },
      ],
    });
  });

  it("provides a deterministic style with no external tile sources", () => {
    const style = noTileDarkStyle();
    expect(style.sources).toEqual({});
    expect(style.layers).toEqual([
      expect.objectContaining({ id: "cartographic-background", type: "background" }),
    ]);
  });
});
