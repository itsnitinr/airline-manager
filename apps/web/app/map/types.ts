export type AirportMapAirport = Readonly<{
  id: string;
  iataCode: string;
  name: string;
  latitudeDeg: string;
  longitudeDeg: string;
}>;

export type AirportMapProps = Readonly<{
  airports: readonly AirportMapAirport[];
  selectedAirportId?: string;
  onSelect?: (airportId: string) => void;
  interactive?: boolean;
  label?: string;
  styleUrl?: string;
}>;

export type AirportMapRenderStatus = "loading" | "ready" | "degraded" | "unavailable" | "error";

export type MapAdapterMountOptions = Readonly<{
  airports: readonly AirportMapAirport[];
  selectedAirportId?: string;
  interactive: boolean;
  label: string;
  reducedMotion: boolean;
  styleUrl?: string;
  onSelect(airportId: string): void;
  onReady(mode: "external" | "fallback"): void;
  onFallback(): void;
  onUnavailable(): void;
  onError(): void;
}>;

export interface AirportMapAdapterInstance {
  update(airports: readonly AirportMapAirport[], selectedAirportId?: string): void;
  destroy(): void;
}

export interface AirportMapAdapter {
  mount(container: HTMLElement, options: MapAdapterMountOptions): AirportMapAdapterInstance;
}
