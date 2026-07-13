import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AirportSelectionList } from "./airport-selection-list";
import type { AirportMapAirport } from "./types";

const airports: readonly AirportMapAirport[] = [
  {
    id: "sin",
    iataCode: "SIN",
    name: "Singapore Changi Airport",
    latitudeDeg: "1.35019",
    longitudeDeg: "103.994003",
  },
  {
    id: "lhr",
    iataCode: "LHR",
    name: "London Heathrow Airport",
    latitudeDeg: "51.470748",
    longitudeDeg: "-0.459909",
  },
];

describe("accessible airport selection", () => {
  it("exposes every map choice through a labelled native control", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <AirportSelectionList
        airports={airports}
        label="Select principal base"
        onSelect={onSelect}
      />,
    );

    const select = screen.getByLabelText("Select principal base") as HTMLSelectElement;
    expect(Array.from(select.options).map(({ text }) => text)).toEqual([
      "Choose an airport",
      "LHR - London Heathrow Airport",
      "SIN - Singapore Changi Airport",
    ]);
    await user.selectOptions(select, "sin");
    expect(onSelect).toHaveBeenCalledWith("sin");
  });

  it("preserves the selected airport when the surrounding form rerenders", () => {
    const view = render(
      <AirportSelectionList
        airports={airports}
        label="Select airport"
        selectedAirportId="lhr"
        onSelect={vi.fn()}
      />,
    );
    view.rerender(
      <AirportSelectionList
        airports={airports}
        label="Select airport"
        selectedAirportId="lhr"
        onSelect={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("Select airport") as HTMLSelectElement).value).toBe("lhr");
  });
});
