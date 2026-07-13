import { describe, expect, it, vi } from "vitest";
import {
  airportFeatureCollection,
  applyOperationsMapPalette,
  noTileDarkStyle,
} from "./maplibre-adapter";
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

  it("normalizes provider geography into the operations palette", () => {
    const setPaintProperty = vi.fn();
    applyOperationsMapPalette({
      getStyle: () => ({
        layers: [
          { id: "background", type: "background" },
          { id: "countries-fill", type: "fill" },
          { id: "countries-boundary", type: "line" },
          { id: "countries-label", type: "symbol" },
        ],
      }),
      setPaintProperty,
    } as never);
    expect(setPaintProperty).toHaveBeenCalledWith("background", "background-color", "#06131b");
    expect(setPaintProperty).toHaveBeenCalledWith("countries-fill", "fill-color", "#10242d");
    expect(setPaintProperty).toHaveBeenCalledWith("countries-boundary", "line-color", "#3b5966");
    expect(setPaintProperty).toHaveBeenCalledWith("countries-label", "text-color", "#8298a2");
  });
});
