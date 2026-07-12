export const workforceRoles = [
  "pilot",
  "cabin_crew",
  "line_maintenance",
  "ground_handling",
] as const;
export type WorkforceRole = (typeof workforceRoles)[number];

export type WorkforceQualification = Readonly<{
  code: string;
  aircraftVariantId?: string;
  catalogReleaseId?: string;
}>;

export type WorkforcePool = Readonly<{
  id: string;
  airlineId: string;
  baseAirportId: string;
  baseIataCode: string;
  role: WorkforceRole;
  qualification: WorkforceQualification;
  activeCapacity: number;
  pendingCapacity: number;
  nextAvailableAt?: string;
  wagePerIntervalMinor: string;
  reportingCurrency: string;
  wageCheckpointAt: string;
  nextWageDueAt: string;
  version: string;
}>;

export type WorkforceStarterPackage = Readonly<{
  variantId: string;
  variantCode: string;
  rulesetVersion: string;
  minimumCapacity: Readonly<Record<WorkforceRole, number>>;
  explanation: string;
}>;

export type HireWorkforceInput = Readonly<{
  role: WorkforceRole;
  capacity: number;
  qualificationAircraftVariantId?: string;
}>;

export type WorkforceHire = Readonly<{
  id: string;
  pool: WorkforcePool;
  capacity: number;
  hiredAt: string;
  availableAt: string;
  status: "training" | "available";
  hiringCostMinor: string;
  trainingCostMinor: string;
  hiringJournalEntryId: string;
  trainingJournalEntryId: string;
}>;

export type WorkforceDemand = Readonly<{
  role: WorkforceRole;
  qualificationCode: string;
  requiredCapacity: number;
}>;

export type WorkforceFlightFacts = Readonly<{
  flightId: string;
  flightNumber: string;
  baseAirportId: string;
  baseIataCode: string;
  aircraftVariantId: string;
  aircraftVariantCode: string;
  economySeats: number;
  departureAt: string;
  arrivalAt: string;
  plannedBlockMinutes: number;
  outsourcedGroundHandling: boolean;
}>;

export type WorkforceAllocation = Readonly<{
  id: string;
  flightId: string;
  poolId: string;
  role: WorkforceRole;
  qualificationCode: string;
  capacity: number;
  dutyStartsAt: string;
  dutyEndsAt: string;
  recoveryEndsAt: string;
}>;

export type WorkforceReadiness = Readonly<{
  flightId: string;
  ready: boolean;
  allocations: readonly WorkforceAllocation[];
  shortages: readonly WorkforceShortage[];
  formulaVersions: Readonly<{
    demand: "slice-one-workforce-demand-v1";
    fatigue: "aggregate-duty-recovery-v1";
  }>;
}>;

export type WorkforceShortage = Readonly<{
  flightId: string;
  flightNumber: string;
  role: WorkforceRole;
  qualificationCode: string;
  baseAirportId: string;
  baseIataCode: string;
  windowStartsAt: string;
  windowEndsAt: string;
  requiredCapacity: number;
  availableCapacity: number;
  shortfall: number;
  correction: string;
}>;

export type WorkforceForecast = Readonly<{
  generatedAt: string;
  through: string;
  feasible: boolean;
  shortages: readonly WorkforceShortage[];
  explanations: readonly string[];
}>;

export type WorkforceWageAccrual = Readonly<{
  poolId: string;
  intervalStartsAt: string;
  intervalEndsAt: string;
  capacity: number;
  amountMinor: string;
  journalEntryId: string;
}>;

export class WorkforceDomainError extends Error {
  public constructor(
    readonly code:
      | "workforce_not_found"
      | "flight_not_found"
      | "invalid_qualification"
      | "invalid_capacity"
      | "idempotency_conflict"
      | "workforce_shortage"
      | "wage_checkpoint_not_due",
    message: string,
    readonly shortages: readonly WorkforceShortage[] = [],
  ) {
    super(message);
    this.name = "WorkforceDomainError";
  }
}

export function qualificationCode(role: WorkforceRole, aircraftVariantCode?: string): string {
  if (role === "pilot") {
    if (!aircraftVariantCode)
      throw new WorkforceDomainError(
        "invalid_qualification",
        "Pilots require a catalog aircraft-variant type rating.",
      );
    return `variant:${aircraftVariantCode}`;
  }
  if (aircraftVariantCode)
    throw new WorkforceDomainError(
      "invalid_qualification",
      `${role} uses the slice-one general qualification.`,
    );
  return "general";
}

export function demandForFlight(flight: WorkforceFlightFacts): readonly WorkforceDemand[] {
  return [
    {
      role: "pilot",
      qualificationCode: qualificationCode("pilot", flight.aircraftVariantCode),
      requiredCapacity: 2,
    },
    {
      role: "cabin_crew",
      qualificationCode: "general",
      requiredCapacity: Math.max(2, Math.ceil(flight.economySeats / 50)),
    },
    { role: "line_maintenance", qualificationCode: "general", requiredCapacity: 1 },
    ...(flight.outsourcedGroundHandling
      ? []
      : [{ role: "ground_handling" as const, qualificationCode: "general", requiredCapacity: 1 }]),
  ];
}

export function recoveryEndsAt(flight: WorkforceFlightFacts, role: WorkforceRole): string {
  const blockHours = Math.ceil(flight.plannedBlockMinutes / 60);
  const [perHour, minimum] =
    role === "pilot" ? [30, 60] : role === "cabin_crew" ? [20, 45] : [0, 30];
  return new Date(
    new Date(flight.arrivalAt).getTime() + Math.max(minimum, blockHours * perHour) * 60_000,
  ).toISOString();
}

export type ForecastPool = Pick<
  WorkforcePool,
  "id" | "baseAirportId" | "role" | "qualification" | "activeCapacity"
>;

/** Deterministic aggregate sweep used for planning; persistence re-checks under pool locks. */
export function forecastWorkforce(
  flights: readonly WorkforceFlightFacts[],
  pools: readonly ForecastPool[],
  generatedAt: Date,
  through: Date,
): WorkforceForecast {
  const reservations = new Map<string, Array<{ start: number; end: number; capacity: number }>>();
  const shortages: WorkforceShortage[] = [];
  for (const flight of [...flights].sort(
    (a, b) => a.departureAt.localeCompare(b.departureAt) || a.flightId.localeCompare(b.flightId),
  )) {
    for (const demand of demandForFlight(flight)) {
      const pool = pools.find(
        (candidate) =>
          candidate.baseAirportId === flight.baseAirportId &&
          candidate.role === demand.role &&
          candidate.qualification.code === demand.qualificationCode,
      );
      const start = Date.parse(flight.departureAt);
      const end = Date.parse(recoveryEndsAt(flight, demand.role));
      const occupied = (pool ? reservations.get(pool.id) : undefined) ?? [];
      const used = occupied
        .filter((window) => window.start < end && window.end > start)
        .reduce((sum, window) => sum + window.capacity, 0);
      const available = Math.max(0, (pool?.activeCapacity ?? 0) - used);
      if (available < demand.requiredCapacity) {
        const shortfall = demand.requiredCapacity - available;
        shortages.push({
          flightId: flight.flightId,
          flightNumber: flight.flightNumber,
          role: demand.role,
          qualificationCode: demand.qualificationCode,
          baseAirportId: flight.baseAirportId,
          baseIataCode: flight.baseIataCode,
          windowStartsAt: flight.departureAt,
          windowEndsAt: new Date(end).toISOString(),
          requiredCapacity: demand.requiredCapacity,
          availableCapacity: available,
          shortfall,
          correction: `Hire and complete training for ${shortfall} ${demand.role.replaceAll("_", " ")} capacity at ${flight.baseIataCode}${demand.role === "pilot" ? ` with ${demand.qualificationCode} rating` : ""}, or remove the overlapping flight.`,
        });
      } else if (pool) {
        occupied.push({ start, end, capacity: demand.requiredCapacity });
        reservations.set(pool.id, occupied);
      }
    }
  }
  return {
    generatedAt: generatedAt.toISOString(),
    through: through.toISOString(),
    feasible: shortages.length === 0,
    shortages,
    explanations: [
      "Capacity is allocated by principal base, role, and catalog-derived qualification.",
      "Overlapping duty and deterministic fatigue-recovery windows consume the same aggregate capacity.",
      "Ground-handling demand is omitted where ticket 12 records eligible outsourced handling.",
    ],
  };
}

export interface WorkforceRepository {
  recommendations(
    playerAccountId: string,
    airlineId: string,
  ): Promise<readonly WorkforceStarterPackage[]>;
  listPools(
    playerAccountId: string,
    airlineId: string,
    now: Date,
  ): Promise<readonly WorkforcePool[]>;
  hire(
    playerAccountId: string,
    airlineId: string,
    input: HireWorkforceInput,
    idempotencyKey: string,
    now: Date,
  ): Promise<WorkforceHire>;
  forecast(
    playerAccountId: string,
    airlineId: string,
    through: Date,
    now: Date,
  ): Promise<WorkforceForecast>;
  allocateFlight(
    playerAccountId: string,
    airlineId: string,
    flightId: string,
    now: Date,
  ): Promise<WorkforceReadiness>;
  accrueWages(
    playerAccountId: string,
    airlineId: string,
    through: Date,
    idempotencyKey: string,
    now: Date,
  ): Promise<readonly WorkforceWageAccrual[]>;
}
