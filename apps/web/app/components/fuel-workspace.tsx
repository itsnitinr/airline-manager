"use client";

import type {
  CreateFuelQuoteResponse,
  GetFuelCapacityOffersResponse,
  GetFuelInventoryResponse,
  GetFuelPricesResponse,
  ListFuelLotsResponse,
  ListFuelMovementsResponse,
} from "@airline-manager/contracts";
import { Drop, Gauge, ShoppingCart, TrendUp, Warning } from "@phosphor-icons/react";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { WebApiError, createStableIdempotencyKey } from "../lib/client-api";
import { formatDateTime, formatMass, formatMoney, formatPercent } from "../lib/planning-format";
import { planningApi } from "../lib/planning-api";
import { Button, Field, OperationalTable, ProvenanceLabel, StateMessage } from "./ui";

export function FuelWorkspace({
  airlineId,
  initialPrices,
  initialInventory,
  initialLots,
  initialMovements,
  capacityOffers,
}: {
  airlineId: string;
  initialPrices: GetFuelPricesResponse;
  initialInventory: GetFuelInventoryResponse;
  initialLots: ListFuelLotsResponse;
  initialMovements: ListFuelMovementsResponse;
  capacityOffers: GetFuelCapacityOffersResponse;
}) {
  const [prices, setPrices] = useState(initialPrices);
  const [inventory, setInventory] = useState(initialInventory);
  const [lots, setLots] = useState(initialLots);
  const [movements, setMovements] = useState(initialMovements);
  const [quantityKg, setQuantityKg] = useState("10000");
  const [reserveKg, setReserveKg] = useState(initialInventory.planningReservedKg);
  const [forecastConsumptionKg, setForecastConsumptionKg] = useState("0");
  const [forecast, setForecast] = useState<Awaited<
    ReturnType<typeof planningApi.forecastFuel>
  > | null>(null);
  const [quote, setQuote] = useState<CreateFuelQuoteResponse | null>(null);
  const confirmationDialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const latestPrice = prices.at(-1);

  useEffect(() => {
    const dialog = confirmationDialogRef.current;
    if (!dialog || !quote) return;
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (!isPending) dialog.querySelector<HTMLButtonElement>("[data-confirm-purchase]")?.focus();
  }, [isPending, quote]);

  function refreshAuthoritative() {
    return Promise.all([
      planningApi.fuelPrices(airlineId),
      planningApi.fuelInventory(airlineId),
      planningApi.fuelLots(airlineId),
      planningApi.fuelMovements(airlineId),
    ]).then(([nextPrices, nextInventory, nextLots, nextMovements]) => {
      setPrices(nextPrices);
      setInventory(nextInventory);
      setLots(nextLots);
      setMovements(nextMovements);
      setReserveKg(nextInventory.planningReservedKg);
    });
  }

  function requestQuote(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        setQuote(await planningApi.quoteFuel(airlineId, quantityKg));
      } catch (cause) {
        setError(messageFor(cause));
      }
    });
  }

  function confirmPurchase() {
    if (!quote) return;
    const key = createStableIdempotencyKey(`ticket20:fuel-purchase:${airlineId}`, quote.id);
    setError(null);
    startTransition(async () => {
      try {
        await planningApi.purchaseFuel(airlineId, quote.id, key);
        await refreshAuthoritative();
        setConfirmation(`${formatMass(quote.quantityKg)} purchased at the quoted price.`);
        setQuote(null);
      } catch (cause) {
        setError(messageFor(cause));
      }
    });
  }

  function saveReserve(event: FormEvent) {
    event.preventDefault();
    const key = createStableIdempotencyKey(`ticket20:fuel-reserve:${airlineId}`, reserveKg);
    startTransition(async () => {
      try {
        await planningApi.setFuelReserve(airlineId, reserveKg, key);
        await refreshAuthoritative();
        setConfirmation("Planning reserve updated from the authoritative inventory.");
      } catch (cause) {
        setError(messageFor(cause));
      }
    });
  }

  function runForecast(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      try {
        setForecast(await planningApi.forecastFuel(airlineId, forecastConsumptionKg));
      } catch (cause) {
        setError(messageFor(cause));
      }
    });
  }

  function upgradeCapacity(tier: number) {
    const key = createStableIdempotencyKey(`ticket20:fuel-capacity:${airlineId}`, String(tier));
    startTransition(async () => {
      try {
        await planningApi.purchaseFuelCapacity(airlineId, tier, key);
        await refreshAuthoritative();
        setConfirmation(`Fuel storage tier ${tier} purchased and refreshed.`);
      } catch (cause) {
        setError(messageFor(cause));
      }
    });
  }

  return (
    <div className="focused-workspace fuel-workspace">
      <header className="workspace-titlebar">
        <div>
          <p className="context-label">Global airline inventory</p>
          <h2>Fuel position and purchasing</h2>
          <p>One fungible inventory; airport-local storage and tankering are not simulated.</p>
        </div>
        <div className="workspace-count">
          <Drop aria-hidden />
          <strong>{formatPercent(inventory.utilizationBasisPoints)}</strong>
          <span>capacity used</span>
        </div>
      </header>
      {error ? (
        <StateMessage tone="critical" title="Fuel action blocked">
          {error}
        </StateMessage>
      ) : null}
      {confirmation ? (
        <StateMessage tone="nominal" title="Inventory refreshed">
          {confirmation}
        </StateMessage>
      ) : null}

      <div className="fuel-control-grid">
        <section className="fuel-position" aria-labelledby="fuel-position-title">
          <header>
            <Gauge aria-hidden />
            <h3 id="fuel-position-title">Inventory position</h3>
            <ProvenanceLabel classification="balance" />
          </header>
          <dl className="metric-ledger">
            <div className="metric-primary">
              <dt>On hand</dt>
              <dd>{formatMass(inventory.onHandKg)}</dd>
            </div>
            <div>
              <dt>Available</dt>
              <dd>{formatMass(inventory.availableKg)}</dd>
            </div>
            <div>
              <dt>Planning reserve</dt>
              <dd>{formatMass(inventory.planningReservedKg)}</dd>
            </div>
            <div>
              <dt>Minimum reserve</dt>
              <dd>{formatMass(inventory.minimumReserveKg)}</dd>
            </div>
            <div>
              <dt>Capacity</dt>
              <dd>{formatMass(inventory.capacityKg)}</dd>
            </div>
            <div>
              <dt>Inventory value</dt>
              <dd>{formatMoney(inventory.inventoryValueMinor, inventory.currency)}</dd>
            </div>
          </dl>
        </section>

        <section className="fuel-market" aria-labelledby="fuel-market-title">
          <header>
            <TrendUp aria-hidden />
            <h3 id="fuel-market-title">Market history</h3>
            <ProvenanceLabel classification="derived" />
          </header>
          <div className="spark-bars" aria-hidden>
            {prices.map((price) => {
              const values = prices.map((item) => Number(item.pricePerTonneMinor));
              const maximum = Math.max(...values, 1);
              return (
                <span
                  key={price.bucketStart}
                  style={{
                    height: `${Math.max(12, (Number(price.pricePerTonneMinor) / maximum) * 100)}%`,
                  }}
                />
              );
            })}
          </div>
          <p>
            {latestPrice
              ? `${formatMoney(latestPrice.pricePerTonneMinor, latestPrice.currency)} per tonne · bucket ends ${formatDateTime(latestPrice.bucketEnd)}`
              : "No price buckets published."}
          </p>
          <details>
            <summary>Accessible price history table</summary>
            <OperationalTable label="Fuel market price history">
              <thead>
                <tr>
                  <th>Effective bucket</th>
                  <th>Price per tonne</th>
                  <th>Formula</th>
                </tr>
              </thead>
              <tbody>
                {prices.map((price) => (
                  <tr key={price.bucketStart}>
                    <th scope="row">{formatDateTime(price.bucketStart)}</th>
                    <td>{formatMoney(price.pricePerTonneMinor, price.currency)}</td>
                    <td>{price.priceFormulaVersion}</td>
                  </tr>
                ))}
              </tbody>
            </OperationalTable>
          </details>
        </section>

        <form
          className="fuel-purchase"
          onSubmit={requestQuote}
          aria-labelledby="fuel-purchase-title"
        >
          <header>
            <ShoppingCart aria-hidden />
            <h3 id="fuel-purchase-title">Quote a purchase</h3>
          </header>
          <Field
            label="Quantity"
            htmlFor="fuel-quantity"
            hint={`Kilograms; ${formatMass(inventory.capacityKg)} total capacity`}
          >
            <input
              id="fuel-quantity"
              inputMode="numeric"
              value={quantityKg}
              onChange={(event) => setQuantityKg(event.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Button className="button-primary" type="submit" disabled={isPending || !quantityKg}>
            Request expiring quote
          </Button>
        </form>

        <form className="fuel-reserve" onSubmit={saveReserve} aria-labelledby="fuel-reserve-title">
          <header>
            <Warning aria-hidden />
            <h3 id="fuel-reserve-title">Reserve policy</h3>
          </header>
          <Field
            label="Planning reserve"
            htmlFor="fuel-reserve"
            hint="Protected from planning availability; cannot exceed on-hand fuel"
          >
            <input
              id="fuel-reserve"
              inputMode="numeric"
              value={reserveKg}
              onChange={(event) => setReserveKg(event.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Button className="button-secondary" type="submit" disabled={isPending}>
            Save reserve
          </Button>
        </form>

        <form
          className="fuel-forecast"
          onSubmit={runForecast}
          aria-labelledby="fuel-forecast-title"
        >
          <header>
            <TrendUp aria-hidden />
            <h3 id="fuel-forecast-title">Burn forecast</h3>
          </header>
          <Field
            label="Projected consumption"
            htmlFor="fuel-consumption"
            hint="Authoritative advisory forecast input in kilograms"
          >
            <input
              id="fuel-consumption"
              inputMode="numeric"
              value={forecastConsumptionKg}
              onChange={(event) => setForecastConsumptionKg(event.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Button className="button-secondary" type="submit" disabled={isPending}>
            Forecast inventory
          </Button>
          {forecast ? (
            <dl>
              <div>
                <dt>Projected on hand</dt>
                <dd>{formatMass(forecast.projectedOnHandKg)}</dd>
              </div>
              <div>
                <dt>Shortage</dt>
                <dd>{formatMass(forecast.projectedShortageKg)}</dd>
              </div>
            </dl>
          ) : null}
        </form>
      </div>

      <section className="capacity-upgrades" aria-labelledby="capacity-title">
        <header>
          <h3 id="capacity-title">Capacity upgrades</h3>
          <p>Material purchases are confirmed against current cash and next-tier rules.</p>
        </header>
        <OperationalTable label="Fuel storage capacity upgrade offers">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Capacity</th>
              <th>Increment</th>
              <th>Price</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {capacityOffers.map((offer) => (
              <tr key={offer.tier}>
                <th scope="row">Tier {offer.tier}</th>
                <td>{formatMass(offer.capacityKg)}</td>
                <td>+{formatMass(offer.incrementalCapacityKg)}</td>
                <td>{formatMoney(offer.priceMinor, offer.currency)}</td>
                <td>
                  <Button
                    className="button-secondary"
                    type="button"
                    onClick={() => upgradeCapacity(offer.tier)}
                    disabled={isPending || offer.tier <= inventory.capacityTier}
                  >
                    Purchase tier {offer.tier}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </OperationalTable>
      </section>

      <div className="fuel-ledger-columns">
        <section>
          <h3>Purchase lots</h3>
          <OperationalTable label="Fuel purchase lots">
            <thead>
              <tr>
                <th>Purchased</th>
                <th>Remaining</th>
                <th>Cost basis</th>
              </tr>
            </thead>
            <tbody>
              {lots.slice(0, 12).map((lot) => (
                <tr key={lot.id}>
                  <th scope="row">{formatDateTime(lot.purchasedAt)}</th>
                  <td>{formatMass(lot.derivedRemainingQuantityKg)}</td>
                  <td>{formatMoney(lot.derivedRemainingCostMinor, lot.currency)}</td>
                </tr>
              ))}
            </tbody>
          </OperationalTable>
        </section>
        <section>
          <h3>Inventory movements</h3>
          <OperationalTable label="Fuel inventory movements">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Quantity</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {movements.slice(0, 12).map((movement) => (
                <tr key={movement.id}>
                  <th scope="row">{formatDateTime(movement.occurredAt)}</th>
                  <td>{movement.type}</td>
                  <td>{movement.quantityDeltaKg} kg</td>
                  <td>{formatMass(movement.balanceAfterKg)}</td>
                </tr>
              ))}
            </tbody>
          </OperationalTable>
        </section>
      </div>

      {quote ? (
        <dialog
          ref={confirmationDialogRef}
          className="confirmation-dialog"
          aria-modal="true"
          aria-labelledby="fuel-confirm-title"
          onCancel={() => setQuote(null)}
        >
          <div>
            <p className="context-label">Quote expires {formatDateTime(quote.expiresAt)}</p>
            <h2 id="fuel-confirm-title">Confirm fuel purchase</h2>
            <p>
              Purchase {formatMass(quote.quantityKg)} for{" "}
              {formatMoney(quote.totalPriceMinor, quote.currency)}. Capacity and cash are rechecked
              by the backend.
            </p>
            <dl>
              <div>
                <dt>Price bucket</dt>
                <dd>{formatDateTime(quote.bucketStart)}</dd>
              </div>
              <div>
                <dt>Formula</dt>
                <dd>{quote.priceFormulaVersion}</dd>
              </div>
            </dl>
            <div className="dialog-actions">
              <Button className="button-secondary" type="button" onClick={() => setQuote(null)}>
                Keep editing
              </Button>
              <Button
                data-confirm-purchase
                className="button-primary"
                type="button"
                onClick={confirmPurchase}
                disabled={isPending}
              >
                Confirm purchase
              </Button>
            </div>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}

function messageFor(cause: unknown) {
  if (cause instanceof WebApiError) return cause.actionable.message;
  return "The fuel service could not complete the request. Entered quantities remain available.";
}
