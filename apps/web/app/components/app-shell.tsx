import type {
  GetAirlineCareerSummaryResponse,
  ListFleetResponse,
} from "@airline-manager/contracts";
import {
  Airplane,
  Bell,
  ChartLineUp,
  Clock,
  Gear,
  MapTrifold,
  Wrench,
} from "@phosphor-icons/react/dist/ssr";
import { AirportMap, type AirportMapAirport } from "../map/airport-map";
import { BrowserNotificationButton, SignOutButton } from "./session-actions";
import { Panel, ProvenanceLabel, StateMessage } from "./ui";

const NAVIGATION = [
  { label: "Network", icon: MapTrifold, available: true },
  { label: "Fleet", icon: Airplane, available: false },
  { label: "Operations", icon: Clock, available: false },
  { label: "Finance", icon: ChartLineUp, available: false },
  { label: "Maintenance", icon: Wrench, available: false },
] as const;

export function AppShell({
  career,
  fleet,
  airports,
  userEmail,
}: {
  career: GetAirlineCareerSummaryResponse;
  fleet: ListFleetResponse;
  airports: readonly AirportMapAirport[];
  userEmail: string;
}) {
  const aircraft = fleet[0];
  const pending = aircraft?.deliveryState === "pending";
  return (
    <div className="application-shell">
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <aside className="desktop-nav">
        <div className="brand-lockup">
          <span style={{ background: career.brand.primaryColor }}>{career.brand.logoMark}</span>
          <div>
            <strong>{career.name}</strong>
            <small>{career.principalBase.iataCode} command</small>
          </div>
        </div>
        <nav aria-label="Primary operations">
          <ul>
            {NAVIGATION.map(({ label, icon: Icon, available }) => (
              <li key={label}>
                {available ? (
                  <a href="#network" aria-current="page">
                    <Icon aria-hidden />
                    {label}
                  </a>
                ) : (
                  <button disabled title={`${label} planning arrives in the next product ticket`}>
                    <Icon aria-hidden />
                    {label}
                    <small>Unavailable</small>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <div className="nav-account">
          <small>{userEmail}</small>
          <BrowserNotificationButton />
          <SignOutButton />
        </div>
      </aside>
      <main id="workspace" className="workspace">
        <header className="workspace-header">
          <div>
            <p className="context-label">Active career</p>
            <h1>{career.name}</h1>
          </div>
          <dl>
            <div>
              <dt>Reporting</dt>
              <dd>{career.reportingCurrency}</dd>
            </div>
            <div>
              <dt>Base</dt>
              <dd>{career.principalBase.iataCode}</dd>
            </div>
            <div>
              <dt>Aircraft</dt>
              <dd>{fleet.length}</dd>
            </div>
          </dl>
        </header>
        <section id="network" className="network-workspace" aria-labelledby="network-title">
          <div className="map-workspace">
            <AirportMap
              airports={airports}
              selectedAirportId={career.principalBase.airportId}
              label={`${career.name} network map`}
              interactive={false}
            />
            <div className="map-overlay">
              <ProvenanceLabel classification="sourced" />
              <span>Principal base</span>
              <strong>{career.principalBase.iataCode}</strong>
              <small>{career.principalBase.name}</small>
            </div>
          </div>
          <aside className="context-rail">
            <header>
              <p className="context-label">Network status</p>
              <h2 id="network-title">Ready for first route</h2>
            </header>
            {pending && aircraft ? (
              <StateMessage tone="warning" title="Aircraft delivery pending">
                {aircraft.manufacturer} {aircraft.model} is due{" "}
                {new Date(aircraft.deliveryTargetAt).toLocaleString()}. This time comes from the
                backend delivery state.
              </StateMessage>
            ) : aircraft ? (
              <StateMessage tone="nominal" title="Founder aircraft delivered">
                {aircraft.manufacturer} {aircraft.model} is at the principal base.
              </StateMessage>
            ) : (
              <StateMessage tone="warning" title="Founder aircraft required">
                Return to onboarding to choose the first operating lease.
              </StateMessage>
            )}
            <Panel className="financial-strip">
              <ProvenanceLabel classification="balance" />
              <h3>Opening position</h3>
              <dl>
                <div>
                  <dt>Cash</dt>
                  <dd>{formatMoney(career.cashMinor, career.reportingCurrency)}</dd>
                </div>
                <div>
                  <dt>Founder equity</dt>
                  <dd>{formatMoney(career.equityMinor, career.reportingCurrency)}</dd>
                </div>
                <div>
                  <dt>Loan liability</dt>
                  <dd>{formatMoney(career.loanLiabilityMinor, career.reportingCurrency)}</dd>
                </div>
              </dl>
            </Panel>
            <Panel className="next-step">
              <h3>Next safe action</h3>
              <p>
                {pending
                  ? "Monitor the authoritative delivery target. Route planning remains unavailable until delivery."
                  : "Route and rotation planning opens in the next product ticket. No planner is simulated here."}
              </p>
              <button type="button" disabled>
                Open route planner <span>Unavailable</span>
              </button>
            </Panel>
            <details className="catalog-note">
              <summary>Map data and attribution</summary>
              <p>
                Airports come from the career&apos;s immutable published catalog. Geography is
                provided for game planning and is not suitable for real-world flight planning.
              </p>
            </details>
          </aside>
        </section>
      </main>
      <nav className="mobile-nav" aria-label="Mobile monitoring">
        <a href="#network" aria-current="page">
          <MapTrifold aria-hidden />
          <span>Network</span>
        </a>
        <button disabled>
          <Bell aria-hidden />
          <span>Alerts</span>
        </button>
        <button disabled>
          <Gear aria-hidden />
          <span>More</span>
        </button>
      </nav>
    </div>
  );
}

function formatMoney(minor: string, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(minor) / 100);
}
