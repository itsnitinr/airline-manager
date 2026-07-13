import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebApiError } from "../lib/client-api";
import { planningApi } from "../lib/planning-api";
import { FuelWorkspace } from "./fuel-workspace";

vi.mock("../lib/planning-api", async () => {
  const actual = await vi.importActual<typeof import("../lib/planning-api")>("../lib/planning-api");
  return {
    ...actual,
    planningApi: { ...actual.planningApi, quoteFuel: vi.fn(), purchaseFuel: vi.fn() },
  };
});

const inventory = {
  airlineId: "airline",
  unit: "kg",
  onHandKg: "20000",
  planningReservedKg: "5000",
  minimumReserveKg: "2000",
  protectedKg: "5000",
  availableKg: "15000",
  capacityKg: "50000",
  capacityTier: 1,
  utilizationBasisPoints: "4000",
  inventoryValueMinor: "1200000",
  currency: "USD",
  weightedUnitCostNumerator: "60",
  weightedUnitCostDenominator: "1",
  version: "1",
} as const;

describe("fuel quote workflow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows quote expiry and preserves quantity when purchase conflicts", async () => {
    vi.mocked(planningApi.quoteFuel).mockResolvedValue({
      id: "quote",
      airlineId: "airline",
      quantityKg: "12345",
      currency: "USD",
      unitPriceNumerator: "1",
      unitPriceDenominator: "1",
      totalPriceMinor: "740700",
      rulesetVersion: "world",
      priceFormulaVersion: "fuel-v1",
      bucketStart: "2026-07-13T00:00:00Z",
      createdAt: "2026-07-13T00:00:00Z",
      expiresAt: "2026-07-13T00:05:00Z",
    });
    vi.mocked(planningApi.purchaseFuel).mockRejectedValue(
      new WebApiError(409, {
        code: "fuel_quote_expired",
        message: "This fuel quote expired. Request a fresh quote; your quantity is preserved.",
        fields: {},
        details: [],
        recoverable: true,
      }),
    );
    const user = userEvent.setup();
    render(
      <FuelWorkspace
        airlineId="airline"
        initialPrices={[]}
        initialInventory={inventory}
        initialLots={[]}
        initialMovements={[]}
        capacityOffers={[]}
      />,
    );
    const quantity = screen.getByLabelText("Quantity");
    await user.clear(quantity);
    await user.type(quantity, "12345");
    await user.click(screen.getByRole("button", { name: "Request expiring quote" }));
    expect(await screen.findByRole("dialog", { name: "Confirm fuel purchase" })).toBeVisible();
    expect(screen.getByText(/Quote expires/)).toBeVisible();
    const confirmPurchase = screen.getByRole("button", { name: "Confirm purchase" });
    await waitFor(() => expect(confirmPurchase).toHaveFocus());
    await user.click(confirmPurchase);
    await waitFor(() => expect(screen.getByText(/This fuel quote expired/)).toBeVisible());
    expect(quantity).toHaveValue("12345");
  });
});
