import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMapLibreAdapter } from "./maplibre-adapter";
import { AirportMapCanvas } from "./airport-map.client";

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
        return { update() {}, destroy() {} };
      },
    });
    render(
      <AirportMapCanvas
        airports={[airport]}
        interactive
        label="Principal base map"
        onSelect={vi.fn()}
      />,
    );
    expect(
      await screen.findByText("Interactive map unavailable. Use the airport list to continue."),
    ).toBeTruthy();
  });

  it("reports an external style failure while retaining the published point layer", async () => {
    vi.mocked(createMapLibreAdapter).mockReturnValue({
      mount: (_container, options) => {
        options.onFallback();
        options.onReady("fallback");
        return { update() {}, destroy() {} };
      },
    });
    render(
      <AirportMapCanvas
        airports={[airport]}
        interactive
        label="Principal base map"
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
    render(<AirportMapCanvas airports={[]} interactive={false} label="Airport network map" />);
    expect(screen.getByText("No published airports available")).toBeTruthy();
    expect(createMapLibreAdapter).not.toHaveBeenCalled();
  });
});
