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
  selectedAirportIds?: readonly string[];
  route?: Readonly<{ originAirportId: string; destinationAirportId: string }>;
  onSelect?: (airportId: string) => void;
  interactive?: boolean;
  label?: string;
  styleUrl?: string;
  presentation?: "contained" | "shell";
}>;

export type AirportMapRenderStatus = "loading" | "ready" | "degraded" | "unavailable" | "error";

export type MapAdapterMountOptions = Readonly<{
  airports: readonly AirportMapAirport[];
  selectedAirportId?: string;
  selectedAirportIds?: readonly string[];
  route?: Readonly<{ originAirportId: string; destinationAirportId: string }>;
  interactive: boolean;
  selectable: boolean;
  label: string;
  reducedMotion: boolean;
  cameraPadding?: Readonly<{ top: number; right: number; bottom: number; left: number }>;
  styleUrl?: string;
  onSelect(airportId: string): void;
  onReady(mode: "external" | "fallback"): void;
  onFallback(): void;
  onUnavailable(): void;
  onError(): void;
}>;

export interface AirportMapAdapterInstance {
  update(
    airports: readonly AirportMapAirport[],
    selectedAirportIds?: readonly string[],
    route?: Readonly<{ originAirportId: string; destinationAirportId: string }>,
  ): void;
  resize(): void;
  destroy(): void;
}

export interface AirportMapAdapter {
  mount(container: HTMLElement, options: MapAdapterMountOptions): AirportMapAdapterInstance;
}
