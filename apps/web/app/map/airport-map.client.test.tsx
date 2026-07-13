import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMapLibreAdapter } from "./maplibre-adapter";
import { AirportMapCanvas } from "./airport-map.client";
import type { MapAdapterMountOptions } from "./types";

vi.mock("./maplibre-adapter", () => ({ createMapLibreAdapter: vi.fn() }));

const airport = {
  id: "lhr",
  iataCode: "LHR",
  name: "London Heathrow Airport",
  latitudeDeg: "51.470748",
  longitudeDeg: "-0.459909",
} as const;

describe("airport map failure states", () => {
  beforeEach(() => vi.mocked(createMapLibreAdapter).mockReset());

  it("keeps the list recovery message available when WebGL is unsupported", async () => {
    vi.mocked(createMapLibreAdapter).mockReturnValue({
      mount: (_container, options) => {
        options.onUnavailable();
        return { update() {}, resize() {}, destroy() {} };
      },
    });
    render(
      <AirportMapCanvas
        airports={[airport]}
        interactive
        selectable
        label="Principal base map"
        presentation="contained"
        onSelect={vi.fn()}
      />,
    );
    expect(
      await screen.findByText(
        "Interactive map unavailable. Published airport data remains available.",
      ),
    ).toBeTruthy();
  });

  it("reports an external style failure while retaining the published point layer", async () => {
    vi.mocked(createMapLibreAdapter).mockReturnValue({
      mount: (_container, options) => {
        options.onFallback();
        options.onReady("fallback");
        return { update() {}, resize() {}, destroy() {} };
      },
    });
    render(
      <AirportMapCanvas
        airports={[airport]}
        interactive
        selectable
        label="Principal base map"
        presentation="contained"
        onSelect={vi.fn()}
        styleUrl="https://tiles.invalid/style.json"
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByText("Base map unavailable. Published airport points remain available."),
      ).toBeTruthy(),
    );
  });

  it("uses the non-map empty state when catalog records are unavailable", () => {
    render(
      <AirportMapCanvas
        airports={[]}
        interactive={false}
        selectable={false}
        label="Airport network map"
        presentation="contained"
      />,
    );
    expect(screen.getByText("No published airports available")).toBeTruthy();
    expect(createMapLibreAdapter).not.toHaveBeenCalled();
  });

  it("keeps shell navigation interactive without enabling airport selection", async () => {
    let mountedOptions: MapAdapterMountOptions | undefined;
    const mount = vi.fn((_container: HTMLElement, options: MapAdapterMountOptions) => {
      mountedOptions = options;
      return { update() {}, resize() {}, destroy() {} };
    });
    vi.mocked(createMapLibreAdapter).mockReturnValue({ mount });
    render(
      <AirportMapCanvas
        airports={[airport]}
        interactive
        selectable={false}
        label="Airline network map"
        presentation="shell"
      />,
    );
    await waitFor(() => expect(mount).toHaveBeenCalledOnce());
    expect(mountedOptions).toMatchObject({
      interactive: true,
      selectable: false,
      cameraPadding: { top: 112, right: 400, bottom: 116, left: 124 },
    });
  });
});
