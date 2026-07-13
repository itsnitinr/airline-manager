import { roundHalfEven } from "./finance.js";

export const flightStates = [
  "scheduled",
  "suspended",
  "cancelled",
  "delayed",
  "boarding",
  "departed",
  "diverted",
  "arrived",
  "settled",
] as const;
export type FlightState = (typeof flightStates)[number];
export const flightMilestones = ["booking_lock", "dispatch", "arrival", "settlement"] as const;
export type FlightMilestone = (typeof flightMilestones)[number];

const legalTransitions: Readonly<Record<FlightState, readonly FlightState[]>> = {
  scheduled: ["suspended", "cancelled", "delayed", "boarding"],
  suspended: ["cancelled", "delayed", "boarding"],
  cancelled: ["settled"],
  delayed: ["suspended", "cancelled", "boarding"],
  boarding: ["suspended", "cancelled", "delayed", "departed"],
  departed: ["diverted", "arrived"],
  diverted: ["arrived"],
  arrived: ["settled"],
  settled: [],
};

export class FlightLifecycleError extends Error {
  public constructor(
    readonly code:
      | "flight_not_found"
      | "illegal_transition"
      | "stale_flight_version"
      | "premature_milestone"
      | "dispatch_requirement_failed"
      | "idempotency_conflict"
      | "settlement_invariant_failed",
    message: string,
    readonly recoverySteps: readonly string[] = [],
  ) {
    super(message);
    this.name = "FlightLifecycleError";
  }
}

export function canTransition(from: FlightState, to: FlightState): boolean {
  return legalTransitions[from].includes(to);
}

export function assertFlightTransition(from: FlightState, to: FlightState): void {
  if (!canTransition(from, to))
    throw new FlightLifecycleError(
      "illegal_transition",
      `Flight cannot transition from ${from} to ${to}.`,
    );
}

export type RealizedFlightInput = Readonly<{
  plannedBlockMinutes: number;
  bookedPassengers: bigint;
  sellableSeats: bigint;
  bookedRevenueMinor: bigint;
  weatherBlockTimeBasisPoints: number;
  weatherFuelBurnBasisPoints: number;
  weatherDelayRiskBasisPoints: number;
  weatherDiversionRiskBasisPoints: number;
  distanceNm: number;
  economySeats: number;
  seed: string;
}>;

export type RealizedFlightOutcome = Readonly<{
  realizedBlockMinutes: number;
  delayMinutes: number;
  diverted: boolean;
  passengersCarried: string;
  fuelBurnKg: string;
  passengerRevenueMinor: string;
  refundMinor: string;
  airportCostMinor: string;
  wageAllocationMinor: string;
  maintenanceAllocationMinor: string;
  operatingResultMinor: string;
  formulaVersion: "flight-realization-v1";
}>;

function hash32(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** Pure bounded realization. All entropy is persisted in `seed`; wall-clock execution is irrelevant. */
export function realizeFlight(input: RealizedFlightInput): RealizedFlightOutcome {
  if (
    !Number.isSafeInteger(input.plannedBlockMinutes) ||
    input.plannedBlockMinutes < 1 ||
    input.bookedPassengers < 0n ||
    input.sellableSeats < 0n ||
    input.bookedPassengers > input.sellableSeats ||
    input.bookedRevenueMinor < 0n
  )
    throw new FlightLifecycleError(
      "settlement_invariant_failed",
      "Realized-flight inputs violate capacity or exact-money invariants.",
    );
  const delayDraw = hash32(`${input.seed}|delay`) % 10_000;
  const diversionDraw = hash32(`${input.seed}|diversion`) % 10_000;
  const delayMinutes =
    delayDraw < input.weatherDelayRiskBasisPoints
      ? 5 + (hash32(`${input.seed}|delay-minutes`) % 12) * 5
      : 0;
  const diverted = diversionDraw < input.weatherDiversionRiskBasisPoints;
  const realizedBlockMinutes = Math.max(
    1,
    Math.ceil((input.plannedBlockMinutes * input.weatherBlockTimeBasisPoints) / 10_000) +
      delayMinutes +
      (diverted ? 30 : 0),
  );
  const baseFuelKg = Math.max(
    1,
    Math.ceil(input.distanceNm * (4 + input.economySeats / 25) + input.plannedBlockMinutes * 2),
  );
  const fuelBurnKg = BigInt(
    Math.ceil((baseFuelKg * input.weatherFuelBurnBasisPoints) / 10_000) + (diverted ? 250 : 0),
  );
  const passengers =
    input.bookedPassengers > input.sellableSeats ? input.sellableSeats : input.bookedPassengers;
  const refundMinor = diverted ? roundHalfEven(input.bookedRevenueMinor, 10n) : 0n;
  const passengerRevenueMinor = input.bookedRevenueMinor;
  const airportCostMinor = BigInt(20_000 + input.economySeats * 120 + (diverted ? 15_000 : 0));
  const wageAllocationMinor = BigInt(realizedBlockMinutes * 85);
  const maintenanceAllocationMinor = BigInt(realizedBlockMinutes * 40 + 2_500);
  const operatingResultMinor =
    passengerRevenueMinor -
    refundMinor -
    airportCostMinor -
    wageAllocationMinor -
    maintenanceAllocationMinor;
  return {
    realizedBlockMinutes,
    delayMinutes,
    diverted,
    passengersCarried: passengers.toString(),
    fuelBurnKg: fuelBurnKg.toString(),
    passengerRevenueMinor: passengerRevenueMinor.toString(),
    refundMinor: refundMinor.toString(),
    airportCostMinor: airportCostMinor.toString(),
    wageAllocationMinor: wageAllocationMinor.toString(),
    maintenanceAllocationMinor: maintenanceAllocationMinor.toString(),
    operatingResultMinor: operatingResultMinor.toString(),
    formulaVersion: "flight-realization-v1",
  };
}

export type FlightTimelineEntry = Readonly<{
  sequence: string;
  fromState: FlightState | null;
  toState: FlightState;
  effectiveAt: string;
  milestone: FlightMilestone | "automatic";
  reasonCode: string;
  explanation: string;
}>;

export type FlightStatus = Readonly<{
  id: string;
  airlineId: string;
  flightNumber: string;
  state: FlightState;
  version: string;
  departureAt: string;
  scheduledArrivalAt: string;
  effectiveAt: string;
  suspension?: Readonly<{
    reasonCode: string;
    explanation: string;
    recoverySteps: readonly string[];
    retryCount: number;
    nextRetryAt?: string;
  }>;
  timeline: readonly FlightTimelineEntry[];
}>;

export type SettledFlightSnapshot = Readonly<{
  id: string;
  flightId: string;
  schemaVersion: 1;
  settledAt: string;
  materialInputs: Readonly<Record<string, unknown>>;
  outcome: RealizedFlightOutcome & Readonly<{ fuelCostMinor: string }>;
  journalEntryIds: readonly string[];
  reconciliation: Readonly<Record<string, string>>;
  contentHash: string;
}>;

export interface FlightOperationsRepository {
  advanceMilestone(
    flightId: string,
    milestone: FlightMilestone,
    expectedVersion: bigint,
    commandId: string,
    effectiveAt: Date,
    processedAt: Date,
  ): Promise<"applied" | "duplicate" | "stale" | "premature" | "noop">;
  status(playerAccountId: string, airlineId: string, flightId: string): Promise<FlightStatus>;
  settlement(
    playerAccountId: string,
    airlineId: string,
    flightId: string,
  ): Promise<SettledFlightSnapshot>;
}
