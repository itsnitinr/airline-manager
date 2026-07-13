import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const maplibre = vi.hoisted(() => {
  type Handler = () => void;

  class FakeMap {
    static instances: FakeMap[] = [];

    readonly canvas = document.createElement("canvas");
    readonly events = new Map<string, Handler>();
    readonly setStyle = vi.fn();
    readonly remove = vi.fn();
    private source: { type: "geojson"; setData: ReturnType<typeof vi.fn> } | undefined;

    constructor() {
      FakeMap.instances.push(this);
    }

    addControl() {}
    addLayer() {}
    fitBounds() {}
    getZoom() {
      return 1;
    }
    getCanvas() {
      return this.canvas;
    }
    getStyle() {
      return { layers: [] };
    }
    setPaintProperty() {}
    addSource() {
      this.source = { type: "geojson", setData: vi.fn() };
    }
    getSource() {
      return this.source;
    }
    on(event: string, handler: Handler) {
      this.events.set(event, handler);
    }
    emit(event: string) {
      this.events.get(event)?.();
    }
    resize() {}
  }

  class FakeLngLatBounds {
    extend() {
      return this;
    }
  }

  return { FakeLngLatBounds, FakeMap };
});

vi.mock("maplibre-gl", () => ({
  default: {
    LngLatBounds: maplibre.FakeLngLatBounds,
    Map: maplibre.FakeMap,
    NavigationControl: class {},
  },
}));

import { createMapLibreAdapter } from "./maplibre-adapter";

const airport = {
  id: "lhr",
  iataCode: "LHR",
  name: "London Heathrow Airport",
  latitudeDeg: "51.470748",
  longitudeDeg: "-0.459909",
} as const;

function mountExternalStyle() {
  const onFallback = vi.fn();
  const onReady = vi.fn();
  const instance = createMapLibreAdapter().mount(document.createElement("div"), {
    airports: [airport],
    interactive: true,
    selectable: false,
    label: "Network map",
    reducedMotion: true,
    styleUrl: "https://tiles.example.test/style.json",
    onSelect: vi.fn(),
    onReady,
    onFallback,
    onUnavailable: vi.fn(),
    onError: vi.fn(),
  });
  const map = maplibre.FakeMap.instances.at(-1)!;
  return { instance, map, onFallback, onReady };
}

describe("MapLibre external style fallback lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    maplibre.FakeMap.instances.length = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps a successfully loaded external style after the fallback deadline", () => {
    const { instance, map, onFallback, onReady } = mountExternalStyle();

    map.emit("style.load");
    vi.advanceTimersByTime(6_000);
    map.emit("error");

    expect(onReady).toHaveBeenCalledWith("external");
    expect(onFallback).not.toHaveBeenCalled();
    expect(map.setStyle).not.toHaveBeenCalled();
    instance.destroy();
  });

  it("uses the no-tile style when the external style fails before readiness", () => {
    const { instance, map, onFallback } = mountExternalStyle();

    map.emit("error");
    vi.advanceTimersByTime(6_000);

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(map.setStyle).toHaveBeenCalledTimes(1);
    instance.destroy();
  });
});
