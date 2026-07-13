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
const routeSourceId = "researched-direct-route";
const routeLayerId = "researched-direct-route-line";
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
  selectedAirportIds: readonly string[] | string = [],
): AirportFeatureCollection {
  const selected =
    typeof selectedAirportIds === "string" ? [selectedAirportIds] : selectedAirportIds;
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
            selected: selected.includes(airport.id),
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

export function applyOperationsMapPalette(map: MapLibreMap): void {
  for (const layer of map.getStyle().layers ?? []) {
    const id = layer.id.toLowerCase();
    try {
      if (layer.type === "background") {
        map.setPaintProperty(layer.id, "background-color", "#06131b");
      } else if (layer.type === "fill") {
        const color = id.includes("water")
          ? "#071720"
          : id.includes("park") || id.includes("vegetation")
            ? "#122820"
            : id.includes("building")
              ? "#172a32"
              : "#10242d";
        map.setPaintProperty(layer.id, "fill-color", color);
        map.setPaintProperty(layer.id, "fill-opacity", 0.94);
      } else if (layer.type === "line") {
        const color = id.includes("boundary") || id.includes("coast") ? "#3b5966" : "#263f4b";
        map.setPaintProperty(layer.id, "line-color", color);
        map.setPaintProperty(layer.id, "line-opacity", id.includes("road") ? 0.46 : 0.72);
      } else if (layer.type === "symbol") {
        map.setPaintProperty(layer.id, "text-color", "#8298a2");
        map.setPaintProperty(layer.id, "text-halo-color", "#07151d");
        map.setPaintProperty(layer.id, "text-halo-width", 1.2);
        map.setPaintProperty(layer.id, "icon-opacity", 0.7);
      }
    } catch {
      // Provider styles may reject properties that are not valid for a specialized layer.
    }
  }
}

function addAirportLayers(
  map: MapLibreMap,
  airports: readonly AirportMapAirport[],
  selectedAirportIds: readonly string[],
  route: MapAdapterMountOptions["route"],
  selectable: boolean,
  cameraPadding: MapAdapterMountOptions["cameraPadding"],
  onSelect: (airportId: string) => void,
): void {
  if (map.getSource(airportSourceId)) return;
  map.addSource(airportSourceId, {
    type: "geojson",
    data: airportFeatureCollection(airports, selectedAirportIds),
  });
  const routeAirports = route
    ? [
        airports.find(({ id }) => id === route.originAirportId),
        airports.find(({ id }) => id === route.destinationAirportId),
      ]
    : [];
  const routeCoordinates = routeAirports.flatMap((airport) => {
    if (!airport) return [];
    const latitude = finiteCoordinate(airport.latitudeDeg, -90, 90);
    const longitude = finiteCoordinate(airport.longitudeDeg, -180, 180);
    return latitude === null || longitude === null
      ? []
      : [[longitude, latitude] as [number, number]];
  });
  map.addSource(routeSourceId, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features:
        routeCoordinates.length === 2
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: routeCoordinates },
              },
            ]
          : [],
    },
  });
  map.addLayer({
    id: routeLayerId,
    type: "line",
    source: routeSourceId,
    paint: {
      "line-color": "#58b7d3",
      "line-width": 2.4,
      "line-opacity": 0.9,
      "line-dasharray": [2, 1.5],
    },
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

  if (selectable) {
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
    map.fitBounds(bounds, { padding: cameraPadding ?? 28, duration: 0, maxZoom: 4.5 });
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
        return { update() {}, resize() {}, destroy() {} };
      }

      let airports = options.airports;
      let selectedAirportIds = options.selectedAirportIds ?? [];
      let route = options.route;
      let usingFallback = !options.styleUrl;
      let airportLayerReady = false;
      let destroyed = false;
      let fallbackStarted = usingFallback;
      let fallbackTimer: number | undefined;

      const clearFallbackTimer = () => {
        if (fallbackTimer === undefined) return;
        window.clearTimeout(fallbackTimer);
        fallbackTimer = undefined;
      };

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
      if (options.interactive) {
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      }
      map.getCanvas().tabIndex = options.interactive ? 0 : -1;
      map.getCanvas().setAttribute("aria-label", `${options.label} canvas`);

      const activateAirportLayer = () => {
        if (destroyed || airportLayerReady) return;
        try {
          applyOperationsMapPalette(map);
          addAirportLayers(
            map,
            airports,
            selectedAirportIds,
            route,
            options.selectable,
            options.cameraPadding,
            options.onSelect,
          );
          airportLayerReady = true;
          if (!usingFallback) clearFallbackTimer();
          options.onReady(usingFallback ? "fallback" : "external");
        } catch {
          options.onError();
        }
      };

      const beginFallback = () => {
        if (destroyed || fallbackStarted) return;
        clearFallbackTimer();
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

      fallbackTimer = options.styleUrl
        ? window.setTimeout(beginFallback, fallbackTimeoutMilliseconds)
        : undefined;

      map.on("style.load", activateAirportLayer);
      map.on("error", () => {
        if (destroyed || usingFallback || airportLayerReady) return;
        // MapLibre also emits non-fatal source and tile errors after a style is usable.
        // Only replace the style while initial external-style readiness is unresolved.
        if (options.styleUrl) beginFallback();
      });

      return {
        update(nextAirports, nextSelectedAirportIds = [], nextRoute) {
          airports = nextAirports;
          selectedAirportIds = nextSelectedAirportIds;
          route = nextRoute;
          const source = sourceFor(map);
          if (!source) return;
          source.setData(airportFeatureCollection(airports, selectedAirportIds));
          const routeSource = map.getSource(routeSourceId) as GeoJSONSource | undefined;
          const endpoints = route
            ? [
                airports.find(({ id }) => id === route!.originAirportId),
                airports.find(({ id }) => id === route!.destinationAirportId),
              ]
            : [];
          const coordinates = endpoints.flatMap((airport) => {
            if (!airport) return [];
            const latitude = finiteCoordinate(airport.latitudeDeg, -90, 90);
            const longitude = finiteCoordinate(airport.longitudeDeg, -180, 180);
            return latitude === null || longitude === null
              ? []
              : [[longitude, latitude] as [number, number]];
          });
          routeSource?.setData({
            type: "FeatureCollection",
            features:
              coordinates.length === 2
                ? [
                    {
                      type: "Feature",
                      properties: {},
                      geometry: { type: "LineString", coordinates },
                    },
                  ]
                : [],
          });
          const selected = airports.find(({ id }) => id === selectedAirportIds.at(-1));
          if (!selected) return;
          const latitude = finiteCoordinate(selected.latitudeDeg, -90, 90);
          const longitude = finiteCoordinate(selected.longitudeDeg, -180, 180);
          if (latitude === null || longitude === null) return;
          const camera = { center: [longitude, latitude] as [number, number], zoom: map.getZoom() };
          if (options.reducedMotion) map.jumpTo(camera);
          else map.easeTo({ ...camera, duration: 200, essential: false });
        },
        resize() {
          map.resize();
        },
        destroy() {
          destroyed = true;
          clearFallbackTimer();
          map.remove();
        },
      };
    },
  };
}
