import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type StyleSpecification,
} from "maplibre-gl";
import type {
  AirportMapAdapter,
  AirportMapAdapterInstance,
  AirportMapAirport,
  MapAdapterMountOptions,
} from "./types";

const airportSourceId = "published-airports";
const airportLayerId = "published-airports-points";
const airportHitLayerId = "published-airports-hit-area";
const selectedLayerId = "published-airport-selection";
const fallbackTimeoutMilliseconds = 6_000;

export type AirportFeatureCollection = Readonly<{
  type: "FeatureCollection";
  features: readonly Readonly<{
    type: "Feature";
    id: string;
    geometry: Readonly<{ type: "Point"; coordinates: readonly [number, number] }>;
    properties: Readonly<{
      airportId: string;
      iataCode: string;
      name: string;
      selected: boolean;
    }>;
  }>[];
}>;

function finiteCoordinate(value: string, minimum: number, maximum: number): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export function airportFeatureCollection(
  airports: readonly AirportMapAirport[],
  selectedAirportId?: string,
): AirportFeatureCollection {
  return {
    type: "FeatureCollection",
    features: airports.flatMap((airport) => {
      const latitude = finiteCoordinate(airport.latitudeDeg, -90, 90);
      const longitude = finiteCoordinate(airport.longitudeDeg, -180, 180);
      if (latitude === null || longitude === null) return [];
      return [
        {
          type: "Feature" as const,
          id: airport.id,
          geometry: { type: "Point" as const, coordinates: [longitude, latitude] as const },
          properties: {
            airportId: airport.id,
            iataCode: airport.iataCode,
            name: airport.name,
            selected: airport.id === selectedAirportId,
          },
        },
      ];
    }),
  };
}

export function noTileDarkStyle(): StyleSpecification {
  return {
    version: 8,
    name: "Airline Manager no-tile fallback",
    sources: {},
    layers: [
      {
        id: "cartographic-background",
        type: "background",
        paint: { "background-color": "#07111b" },
      },
    ],
  };
}

function addAirportLayers(
  map: MapLibreMap,
  airports: readonly AirportMapAirport[],
  selectedAirportId: string | undefined,
  interactive: boolean,
  onSelect: (airportId: string) => void,
): void {
  if (map.getSource(airportSourceId)) return;
  map.addSource(airportSourceId, {
    type: "geojson",
    data: airportFeatureCollection(airports, selectedAirportId),
  });
  map.addLayer({
    id: airportLayerId,
    type: "circle",
    source: airportSourceId,
    paint: {
      "circle-color": "#8aafc2",
      "circle-opacity": 0.82,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 1.8, 6, 3.4],
      "circle-stroke-color": "#07111b",
      "circle-stroke-width": 0.8,
    },
  });
  map.addLayer({
    id: selectedLayerId,
    type: "circle",
    source: airportSourceId,
    filter: ["==", ["get", "selected"], true],
    paint: {
      "circle-color": "#d8f4ff",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 4.2, 6, 7.2],
      "circle-stroke-color": "#2d9fc6",
      "circle-stroke-width": 2,
    },
  });

  if (interactive) {
    map.addLayer({
      id: airportHitLayerId,
      type: "circle",
      source: airportSourceId,
      paint: { "circle-color": "#000000", "circle-opacity": 0, "circle-radius": 12 },
    });
    map.on("click", airportHitLayerId, (event) => {
      const airportId = event.features?.[0]?.properties.airportId;
      if (typeof airportId === "string") onSelect(airportId);
    });
    map.on("mouseenter", airportHitLayerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", airportHitLayerId, () => {
      map.getCanvas().style.cursor = "";
    });
  }

  const coordinates = airportFeatureCollection(airports).features.map(
    ({ geometry }) => [...geometry.coordinates] as [number, number],
  );
  if (coordinates.length > 0) {
    const bounds = coordinates.reduce(
      (value, coordinate) => value.extend(coordinate),
      new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
    );
    map.fitBounds(bounds, { padding: 28, duration: 0, maxZoom: 4.5 });
  }
}

function sourceFor(map: MapLibreMap): GeoJSONSource | null {
  const source = map.getSource(airportSourceId);
  return source?.type === "geojson" ? (source as GeoJSONSource) : null;
}

function webGlSupported(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) !== null;
  } catch {
    return false;
  }
}

export function createMapLibreAdapter(): AirportMapAdapter {
  return {
    mount(container: HTMLElement, options: MapAdapterMountOptions): AirportMapAdapterInstance {
      if (!webGlSupported()) {
        options.onUnavailable();
        return { update() {}, destroy() {} };
      }

      let airports = options.airports;
      let selectedAirportId = options.selectedAirportId;
      let usingFallback = !options.styleUrl;
      let airportLayerReady = false;
      let destroyed = false;
      let fallbackStarted = usingFallback;

      const map = new maplibregl.Map({
        container,
        style: options.styleUrl ?? noTileDarkStyle(),
        center: [10, 22],
        zoom: 0.8,
        minZoom: 0.3,
        maxZoom: 12,
        maxPitch: 0,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        renderWorldCopies: false,
        interactive: options.interactive,
        cooperativeGestures: true,
        attributionControl: {
          compact: true,
          customAttribution: [
            '<a href="https://maplibre.org/" target="_blank" rel="noopener noreferrer">MapLibre</a>',
            "Airport data: published catalog",
          ],
        },
      });
      map.getCanvas().tabIndex = options.interactive ? 0 : -1;
      map.getCanvas().setAttribute("aria-label", `${options.label} canvas`);

      const activateAirportLayer = () => {
        if (destroyed || airportLayerReady) return;
        try {
          addAirportLayers(map, airports, selectedAirportId, options.interactive, options.onSelect);
          airportLayerReady = true;
          options.onReady(usingFallback ? "fallback" : "external");
        } catch {
          options.onError();
        }
      };

      const beginFallback = () => {
        if (destroyed || fallbackStarted) return;
        fallbackStarted = true;
        usingFallback = true;
        airportLayerReady = false;
        options.onFallback();
        try {
          map.setStyle(noTileDarkStyle());
        } catch {
          options.onError();
        }
      };

      map.on("style.load", activateAirportLayer);
      map.on("error", () => {
        if (destroyed) return;
        if (options.styleUrl && !airportLayerReady) beginFallback();
        else options.onFallback();
      });

      const fallbackTimer = options.styleUrl
        ? window.setTimeout(beginFallback, fallbackTimeoutMilliseconds)
        : undefined;

      return {
        update(nextAirports, nextSelectedAirportId) {
          airports = nextAirports;
          selectedAirportId = nextSelectedAirportId;
          const source = sourceFor(map);
          if (!source) return;
          source.setData(airportFeatureCollection(airports, selectedAirportId));
          const selected = airports.find(({ id }) => id === selectedAirportId);
          if (!selected) return;
          const latitude = finiteCoordinate(selected.latitudeDeg, -90, 90);
          const longitude = finiteCoordinate(selected.longitudeDeg, -180, 180);
          if (latitude === null || longitude === null) return;
          const camera = { center: [longitude, latitude] as [number, number], zoom: map.getZoom() };
          if (options.reducedMotion) map.jumpTo(camera);
          else map.easeTo({ ...camera, duration: 320, essential: false });
        },
        destroy() {
          destroyed = true;
          if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
          map.remove();
        },
      };
    },
  };
}
