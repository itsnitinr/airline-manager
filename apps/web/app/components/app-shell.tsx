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
import { ShellDisclosure } from "./shell-disclosure";
import { ProvenanceLabel, StateMessage } from "./ui";

const NAVIGATION = [
  { label: "Network", icon: MapTrifold, available: true },
  { label: "Fleet", icon: Airplane, available: false },
  { label: "Operations", icon: Clock, available: false },
  { label: "Finance", icon: ChartLineUp, available: false },
  { label: "Maintenance", icon: Wrench, available: false },
] as const;

function readableBrandMarkColor(background: string) {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(background);
  if (!match) return "#071118";

  const channels = match.slice(1).map((value) => {
    const channel = Number.parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return luminance > 0.179 ? "#071118" : "#f5fbfd";
}

export function AppShell({
  career,
  fleet,
  airports,
  userEmail,
  mapStyleUrl,
}: {
  career: GetAirlineCareerSummaryResponse;
  fleet: ListFleetResponse;
  airports: readonly AirportMapAirport[];
  userEmail: string;
  mapStyleUrl?: string;
}) {
  const aircraft = fleet[0];
  const pending = aircraft?.deliveryState === "pending";
  const trayTitle = pending ? "Monitor aircraft delivery" : "Network ready";
  const trayDetail = aircraft
    ? `${aircraft.manufacturer} ${aircraft.model} · ${career.principalBase.iataCode}`
    : `Founder aircraft required · ${career.principalBase.iataCode}`;
  return (
    <div className="application-shell">
      <nav className="skip-navigation" aria-label="Skip navigation">
        <a className="skip-link" href="#workspace">
          Skip to workspace
        </a>
      </nav>
      <section id="network" className="network-canvas" aria-labelledby="network-workspace-title">
        <h2 className="sr-only" id="network-workspace-title">
          {career.name} network workspace
        </h2>
        <AirportMap
          airports={airports}
          selectedAirportId={career.principalBase.airportId}
          label={`${career.name} network map`}
          interactive
          presentation="shell"
          {...(mapStyleUrl === undefined ? {} : { styleUrl: mapStyleUrl })}
        />
      </section>
      <aside className="desktop-nav" aria-label="Airline navigation rail">
        <div className="brand-lockup">
          <span
            style={{
              background: career.brand.primaryColor,
              color: readableBrandMarkColor(career.brand.primaryColor),
            }}
          >
            {career.brand.logoMark}
          </span>
          <div>
            <strong>{career.name}</strong>
            <small>{career.principalBase.iataCode}</small>
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
                  <button disabled>
                    <Icon aria-hidden />
                    <span>{label}</span>
                    <small>Unavailable</small>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <div className="nav-account">
          <small>{userEmail}</small>
          <BrowserNotificationButton statusId="desktop-browser-notification-status" />
          <SignOutButton />
        </div>
      </aside>
      <main id="workspace" className="workspace">
        <header className="workspace-header" aria-label="Operational status">
          <div className="status-identity">
            <span style={{ background: career.brand.primaryColor }}>{career.brand.logoMark}</span>
            <div>
              <p>Active airline</p>
              <h1>{career.name}</h1>
            </div>
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
        <ShellDisclosure
          trayTitle={trayTitle}
          trayDetail={trayDetail}
          mobileUtilities={
            <>
              <small>{userEmail}</small>
              <BrowserNotificationButton statusId="mobile-browser-notification-status" />
              <SignOutButton />
            </>
          }
        >
          <div className="context-rail">
            <header className="inspector-intro">
              <p className="context-label">Network status</p>
              <h2>Ready for first route</h2>
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
            <section className="financial-strip" aria-labelledby="opening-position-title">
              <ProvenanceLabel classification="balance" />
              <h3 id="opening-position-title">Opening position</h3>
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
            </section>
            <section className="next-step" aria-labelledby="next-safe-action-title">
              <h3 id="next-safe-action-title">Next safe action</h3>
              <p>
                {pending
                  ? "Monitor the authoritative delivery target. Route planning remains unavailable until delivery."
                  : "Network planning is not available yet. No route or rotation has been created."}
              </p>
              <button type="button" disabled>
                Open route planner <span>Unavailable</span>
              </button>
            </section>
            <details className="catalog-note">
              <summary>Map data and attribution</summary>
              <p>
                Airports come from the career&apos;s immutable published catalog. Geography is
                provided for game planning and is not suitable for real-world flight planning.
              </p>
            </details>
          </div>
        </ShellDisclosure>
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
