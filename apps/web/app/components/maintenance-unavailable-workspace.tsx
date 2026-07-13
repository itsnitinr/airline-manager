import type { ListFleetResponse } from "@airline-manager/contracts";
import { Airplane } from "@phosphor-icons/react/dist/ssr";
import { formatDateTime } from "../lib/planning-format";
import { StateMessage } from "./ui";

export function MaintenanceUnavailableWorkspace({
  aircraft,
}: {
  aircraft: ListFleetResponse[number];
}) {
  const awaitingDelivery = aircraft.deliveryState === "pending";
  return (
    <div className="focused-workspace maintenance-workspace">
      <header className="workspace-titlebar">
        <div>
          <p className="context-label">Aircraft maintenance program</p>
          <h2>Maintenance readiness unavailable</h2>
          <p>
            {aircraft.manufacturer} {aircraft.model} · {aircraft.serialNumber}
          </p>
        </div>
        <div className="workspace-count">
          <Airplane aria-hidden />
          <strong>{awaitingDelivery ? "Pending" : "Unavailable"}</strong>
          <span>delivery state</span>
        </div>
      </header>

      <StateMessage
        tone="warning"
        title={awaitingDelivery ? "Maintenance begins after delivery" : "Aircraft unavailable"}
        action={<a href="/app?view=fleet">Review fleet delivery</a>}
      >
        {awaitingDelivery
          ? `The authoritative maintenance program starts when this aircraft is delivered. Current target: ${formatDateTime(aircraft.deliveryTargetAt)}.`
          : `This aircraft is ${aircraft.deliveryState} and has no active maintenance forecast.`}
      </StateMessage>
    </div>
  );
}
