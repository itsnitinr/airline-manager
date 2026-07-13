import type {
  GetAirlineCareerSummaryResponse,
  ListFleetResponse,
} from "@airline-manager/contracts";
import {
  Airplane,
  Bell,
  ChartLineUp,
  Clock,
  Drop,
  MapTrifold,
  UsersThree,
  Wrench,
} from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import { SignOutButton } from "./session-actions";

export type PlanningView = "network" | "fleet" | "fuel" | "workforce" | "maintenance";

const AVAILABLE_NAVIGATION = [
  { id: "network", label: "Network", icon: MapTrifold },
  { id: "fleet", label: "Fleet", icon: Airplane },
  { id: "fuel", label: "Fuel", icon: Drop },
  { id: "workforce", label: "Workforce", icon: UsersThree },
  { id: "maintenance", label: "Maintenance", icon: Wrench },
] as const;

const DEFERRED_NAVIGATION = [
  { label: "Operations", icon: Clock, owner: "Ticket 21" },
  { label: "Finance", icon: ChartLineUp, owner: "Ticket 21" },
  { label: "Notifications", icon: Bell, owner: "Ticket 21" },
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
  userEmail,
  activeView,
  children,
}: {
  career: GetAirlineCareerSummaryResponse;
  fleet: ListFleetResponse;
  userEmail: string;
  activeView: PlanningView;
  children: ReactNode;
}) {
  return (
    <div className="application-shell" data-planning-view={activeView}>
      <nav className="skip-navigation" aria-label="Skip navigation">
        <a className="skip-link" href="#workspace">
          Skip to workspace
        </a>
      </nav>

      <aside className="desktop-nav" aria-label="Airline navigation rail">
        <a className="brand-lockup" href="/app?view=network" aria-label={`${career.name} network`}>
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
            <small>{career.principalBase.iataCode} control</small>
          </div>
        </a>
        <nav aria-label="Planning destinations">
          <ul>
            {AVAILABLE_NAVIGATION.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <a href={`/app?view=${id}`} aria-current={activeView === id ? "page" : undefined}>
                  <Icon aria-hidden />
                  <span>{label}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="deferred-navigation" aria-label="Unavailable destinations">
          <p>Later operations</p>
          {DEFERRED_NAVIGATION.map(({ label, icon: Icon, owner }) => (
            <button key={label} type="button" disabled title={`${label} is owned by ${owner}`}>
              <Icon aria-hidden />
              <span>{label}</span>
              <small>{owner}</small>
            </button>
          ))}
        </div>
        <div className="nav-account">
          <small>{userEmail}</small>
          <SignOutButton />
        </div>
      </aside>

      <header className="workspace-header" aria-label="Planning status">
        <div className="status-identity">
          <span style={{ background: career.brand.primaryColor }}>{career.brand.logoMark}</span>
          <div>
            <p>Planning control</p>
            <h1>{AVAILABLE_NAVIGATION.find(({ id }) => id === activeView)?.label}</h1>
          </div>
        </div>
        <dl>
          <div>
            <dt>Base</dt>
            <dd>{career.principalBase.iataCode}</dd>
          </div>
          <div>
            <dt>Aircraft</dt>
            <dd>{fleet.length}</dd>
          </div>
          <div>
            <dt>Reporting</dt>
            <dd>{career.reportingCurrency}</dd>
          </div>
        </dl>
      </header>

      <main id="workspace" className="workspace">
        {children}
      </main>

      <nav className="mobile-nav" aria-label="Mobile planning navigation">
        {AVAILABLE_NAVIGATION.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            href={`/app?view=${id}`}
            aria-current={activeView === id ? "page" : undefined}
          >
            <Icon aria-hidden />
            <span>{label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
