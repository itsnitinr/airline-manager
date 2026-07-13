"use client";

import type { FinanceOverview, FinanceStatements, JournalPage } from "@airline-manager/domain";
import dynamic from "next/dynamic";
import { startTransition, useState } from "react";
import { formatDateTime, formatMass, formatMoney } from "../lib/planning-format";
import { LiveAuthorityStatus } from "./live-authority-status";

const AdvancedFinance = dynamic(
  () => import("./advanced-finance").then(({ AdvancedFinance }) => AdvancedFinance),
  { loading: () => <p className="empty-inline">Loading ledger statement module.</p> },
);

export function FinanceWorkspace({
  overview,
  statements,
  journals,
}: {
  overview: FinanceOverview;
  statements: FinanceStatements;
  journals: JournalPage;
}) {
  const [mode, setMode] = useState<"overview" | "statements">("overview");
  return (
    <section className="finance-workspace focused-workspace">
      <header className="finance-titlebar">
        <div>
          <p className="eyebrow">Ledger-derived analytical workstation</p>
          <h2>Financial control</h2>
          <small>
            Reporting currency {overview.reportingCurrency} · as of {formatDateTime(overview.asOf)}
          </small>
        </div>
        <div className="view-switch" role="group" aria-label="Finance view">
          <button
            type="button"
            aria-pressed={mode === "overview"}
            onClick={() => startTransition(() => setMode("overview"))}
          >
            Overview
          </button>
          <button
            type="button"
            aria-pressed={mode === "statements"}
            onClick={() => startTransition(() => setMode("statements"))}
          >
            Statements
          </button>
        </div>
        <LiveAuthorityStatus />
      </header>
      {mode === "overview" ? (
        <div className="finance-overview">
          <section className="finance-position" aria-label="Cash and runway position">
            <div className="position-primary">
              <span>Ledger cash</span>
              <strong>{formatMoney(overview.cashMinor, overview.reportingCurrency)}</strong>
              <small>Posted journals through {formatDateTime(overview.asOf)}</small>
            </div>
            <div>
              <span>30-day obligations</span>
              <strong>
                {formatMoney(overview.upcomingObligationsMinor, overview.reportingCurrency)}
              </strong>
            </div>
            <div>
              <span>Obligation-only runway</span>
              <strong>
                {overview.runwayDays === null ? "Not bounded" : `${overview.runwayDays} days`}
              </strong>
            </div>
            <p>{overview.runwayExplanation}</p>
          </section>
          <section className="finance-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Contract schedule</p>
                <h3>Upcoming obligations</h3>
              </div>
              <small>Founder loan and operating lease only</small>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Due</th>
                    <th scope="col">State</th>
                    <th scope="col">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.obligations.map((obligation) => (
                    <tr key={obligation.id}>
                      <th scope="row">{obligation.kind.replaceAll("_", " ")}</th>
                      <td>{formatDateTime(obligation.dueAt)}</td>
                      <td>
                        <span className="state-label" data-state={obligation.status}>
                          {obligation.status}
                        </span>
                      </td>
                      <td>{formatMoney(obligation.amountMinor, obligation.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {overview.obligations.length === 0 ? (
              <p className="empty-inline">
                No scheduled obligation falls inside this 30-day horizon.
              </p>
            ) : null}
          </section>
          <section className="finance-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Immutable settled flights</p>
                <h3>Route profitability</h3>
              </div>
              <small>Backend aggregation, not client recomputation</small>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Route</th>
                    <th scope="col">Settled flights</th>
                    <th scope="col">Revenue</th>
                    <th scope="col">Attributed costs</th>
                    <th scope="col">Operating result</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.routeProfitability.map((route) => (
                    <tr key={route.routeId}>
                      <th scope="row">
                        <a href={`/app?view=network&route=${route.routeId}`}>
                          {route.originIataCode} → {route.destinationIataCode}
                        </a>
                      </th>
                      <td>{route.settledFlights}</td>
                      <td>{formatMoney(route.realizedRevenueMinor, overview.reportingCurrency)}</td>
                      <td>{formatMoney(route.realizedCostMinor, overview.reportingCurrency)}</td>
                      <td>{formatMoney(route.operatingResultMinor, overview.reportingCurrency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="finance-split">
            <div className="finance-section">
              <p className="eyebrow">Authoritative fuel inventory</p>
              <h3>Fuel cost exposure</h3>
              <dl className="detail-facts">
                <div>
                  <dt>On hand</dt>
                  <dd>{formatMass(overview.fuel.onHandKg)}</dd>
                </div>
                <div>
                  <dt>Inventory value</dt>
                  <dd>
                    {formatMoney(overview.fuel.inventoryValueMinor, overview.reportingCurrency)}
                  </dd>
                </div>
                <div>
                  <dt>Weighted cost</dt>
                  <dd>
                    {overview.fuel.weightedUnitCostNumerator}/
                    {overview.fuel.weightedUnitCostDenominator} minor units per kg
                  </dd>
                </div>
              </dl>
              <a className="button button-quiet" href="/app?view=fuel">
                Open fuel control
              </a>
            </div>
            <div className="finance-section">
              <p className="eyebrow">Latest realized operations</p>
              <h3>Flight results</h3>
              <ol className="result-list">
                {overview.recentResults.map((result) => (
                  <li key={result.flightId}>
                    <a href={`/app?view=operations&flight=${result.flightId}`}>
                      {result.flightNumber}
                    </a>
                    <span>{formatDateTime(result.settledAt)}</span>
                    <strong>
                      {formatMoney(result.operatingResultMinor, overview.reportingCurrency)}
                    </strong>
                  </li>
                ))}
              </ol>
            </div>
          </section>
          <p className="reporting-basis">
            Supported transaction currencies: {overview.supportedTransactionCurrencies.join(", ")}.
            Every journal preserves its original currency and posted reporting snapshot.
          </p>
        </div>
      ) : (
        <AdvancedFinance statements={statements} journals={journals} />
      )}
    </section>
  );
}
