export type MaintenanceWorkKind = "line" | "package";
export type MaintenanceDueState = "not_due" | "due" | "soft_overdue" | "hard_overdue";
export type FaultOutcome = "none" | "delay" | "grounding";

export type MaintenanceRule = Readonly<{
  id: string;
  code: string;
  name: string;
  kind: MaintenanceWorkKind;
  intervalHoursMinutes?: string;
  intervalCycles?: string;
  intervalCalendarDays?: number;
  hardLimit: boolean;
  maximumDeferralHoursMinutes: string;
  maximumDeferralCycles: string;
  maximumDeferralCalendarDays: number;
  durationMinutes: number;
  workforceCapacity: number;
  costMinor: string;
  conditionRestoreBasisPoints: number;
}>;

export type MaintenanceProgram = Readonly<{
  id: string;
  version: string;
  aircraftVariantId: string;
  aircraftVariantCode: string;
  utilizationFormulaVersion: string;
  conditionFormulaVersion: string;
  faultFormulaVersion: string;
  calendarSemantics: "elapsed_utc_days";
  rules: readonly MaintenanceRule[];
}>;

export type MaintenanceCounterSnapshot = Readonly<{
  accumulatedHoursMinutes: bigint;
  accumulatedCycles: bigint;
  calendarStartedAt: Date;
  measuredAt: Date;
}>;

export type MaintenanceDueAssessment = Readonly<{
  ruleCode: string;
  state: MaintenanceDueState;
  hoursMinutesRemaining?: string;
  cyclesRemaining?: string;
  calendarDaysRemaining?: number;
  hardLimitExceeded: boolean;
  explanation: string;
  recoveryStep: string;
}>;

export function assessMaintenanceDue(
  rule: MaintenanceRule,
  baseline: MaintenanceCounterSnapshot,
  current: MaintenanceCounterSnapshot,
): MaintenanceDueAssessment {
  const usedMinutes = current.accumulatedHoursMinutes - baseline.accumulatedHoursMinutes;
  const usedCycles = current.accumulatedCycles - baseline.accumulatedCycles;
  const elapsedDays = Math.max(
    0,
    Math.floor((current.measuredAt.getTime() - baseline.calendarStartedAt.getTime()) / 86_400_000),
  );
  const hourRemaining =
    rule.intervalHoursMinutes === undefined
      ? undefined
      : BigInt(rule.intervalHoursMinutes) - usedMinutes;
  const cycleRemaining =
    rule.intervalCycles === undefined ? undefined : BigInt(rule.intervalCycles) - usedCycles;
  const calendarRemaining =
    rule.intervalCalendarDays === undefined ? undefined : rule.intervalCalendarDays - elapsedDays;
  const remaining = [
    hourRemaining === undefined ? undefined : Number(hourRemaining),
    cycleRemaining === undefined ? undefined : Number(cycleRemaining),
    calendarRemaining,
  ].filter((value): value is number => value !== undefined);
  const overdueBy = [
    hourRemaining === undefined ? 0 : Math.max(0, Number(-hourRemaining)),
    cycleRemaining === undefined ? 0 : Math.max(0, Number(-cycleRemaining)),
    calendarRemaining === undefined ? 0 : Math.max(0, -calendarRemaining),
  ];
  const due = remaining.some((value) => value <= 0);
  const hardExceeded =
    due &&
    (rule.hardLimit ||
      overdueBy[0]! > Number(BigInt(rule.maximumDeferralHoursMinutes)) ||
      overdueBy[1]! > Number(BigInt(rule.maximumDeferralCycles)) ||
      overdueBy[2]! > rule.maximumDeferralCalendarDays);
  const softOverdue = due && overdueBy.some((value) => value > 0);
  const state: MaintenanceDueState = hardExceeded
    ? "hard_overdue"
    : softOverdue
      ? "soft_overdue"
      : due
        ? "due"
        : "not_due";
  return {
    ruleCode: rule.code,
    state,
    ...(hourRemaining === undefined ? {} : { hoursMinutesRemaining: hourRemaining.toString() }),
    ...(cycleRemaining === undefined ? {} : { cyclesRemaining: cycleRemaining.toString() }),
    ...(calendarRemaining === undefined ? {} : { calendarDaysRemaining: calendarRemaining }),
    hardLimitExceeded: hardExceeded,
    explanation:
      state === "not_due"
        ? `${rule.name} remains inside its utilization and real-calendar limits.`
        : state === "due"
          ? `${rule.name} has reached a due threshold.`
          : state === "soft_overdue"
            ? `${rule.name} is inside its bounded auditable deferral allowance; condition and reliability consequences apply.`
            : `${rule.name} exceeded a hard limit or its bounded deferral allowance and blocks dispatch.`,
    recoveryStep: `Reserve a ${rule.durationMinutes}-minute ${rule.kind} maintenance window with ${rule.workforceCapacity} qualified line-maintenance capacity and complete ${rule.name}.`,
  };
}

export function conditionAfterUtilization(
  conditionBasisPoints: number,
  hoursMinutes: bigint,
  cycles: bigint,
  assessments: readonly MaintenanceDueAssessment[],
): Readonly<{ conditionBasisPoints: number; dispatchReliabilityBasisPoints: number }> {
  const normalWear = Number(hoursMinutes / 120n) + Number(cycles) * 2;
  const deferralWear = assessments.reduce(
    (total, assessment) =>
      total +
      (assessment.state === "soft_overdue" ? 20 : assessment.state === "hard_overdue" ? 60 : 0),
    0,
  );
  const condition = Math.max(0, Math.min(10_000, conditionBasisPoints - normalWear - deferralWear));
  return {
    conditionBasisPoints: condition,
    dispatchReliabilityBasisPoints: Math.max(
      5_000,
      Math.min(9_990, 8_000 + Math.floor(condition / 5) - deferralWear),
    ),
  };
}

export type FaultInputSnapshot = Readonly<{
  aircraftId: string;
  completionKey: string;
  programVersion: string;
  conditionBasisPoints: number;
  dispatchReliabilityBasisPoints: number;
  accumulatedHoursMinutes: string;
  accumulatedCycles: string;
}>;

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export type DeterministicFault = Readonly<{
  outcome: FaultOutcome;
  severity: "none" | "minor" | "major";
  delayMinutes: number;
  groundsAircraft: boolean;
  repairDurationMinutes: number;
  repairWorkforceCapacity: number;
  repairCostMultiplierBasisPoints: number;
  explanation: string;
}>;

/** Pure, bounded and replayable. No outcome can destroy an aircraft or harm passengers. */
export function deterministicFault(seed: string, snapshot: FaultInputSnapshot): DeterministicFault {
  const draw = stableHash(`${seed}|${JSON.stringify(snapshot)}`) % 10_000;
  const risk = Math.min(
    2_500,
    25 +
      Math.floor((10_000 - snapshot.conditionBasisPoints) / 8) +
      Math.floor((10_000 - snapshot.dispatchReliabilityBasisPoints) / 12),
  );
  if (draw >= risk)
    return {
      outcome: "none",
      severity: "none",
      delayMinutes: 0,
      groundsAircraft: false,
      repairDurationMinutes: 0,
      repairWorkforceCapacity: 0,
      repairCostMultiplierBasisPoints: 0,
      explanation: "The deterministic post-flight inspection found no unscheduled fault.",
    };
  const grounding = stableHash(`${seed}|grounding|${snapshot.completionKey}`) % 4 === 0;
  if (grounding)
    return {
      outcome: "grounding",
      severity: "major",
      delayMinutes: 0,
      groundsAircraft: true,
      repairDurationMinutes: 360,
      repairWorkforceCapacity: 2,
      repairCostMultiplierBasisPoints: 20_000,
      explanation:
        "A bounded major fault grounds the aircraft until the explicit repair work is completed.",
    };
  return {
    outcome: "delay",
    severity: "minor",
    delayMinutes: 30 + (stableHash(`${seed}|delay`) % 7) * 15,
    groundsAircraft: false,
    repairDurationMinutes: 120,
    repairWorkforceCapacity: 1,
    repairCostMultiplierBasisPoints: 12_500,
    explanation: "A bounded minor fault requires line repair and can produce a reproducible delay.",
  };
}

export type FlightCompletionUtilizationInput = Readonly<{
  completionKey: string;
  aircraftId: string;
  completedAt: string;
  blockMinutes: number;
  cycles: number;
  faultSeed: string;
}>;

export type FlightCompletionUtilizationResult = Readonly<{
  completionKey: string;
  aircraftId: string;
  accumulatedHoursMinutes: string;
  accumulatedCycles: string;
  conditionBasisPoints: number;
  dispatchReliabilityBasisPoints: number;
  programVersion: string;
  fault: DeterministicFault & Readonly<{ id?: string }>;
  processedAt: string;
}>;

export type MaintenanceWindowInput = Readonly<{
  ruleCode?: string;
  faultId?: string;
  startsAt: string;
}>;

export type MaintenanceWorkPackage = Readonly<{
  id: string;
  aircraftId: string;
  source: "planned" | "repair";
  ruleCode?: string;
  faultId?: string;
  status: "planned" | "completed";
  startsAt: string;
  endsAt: string;
  airportId: string;
  workforceCapacity: number;
  costMinor: string;
  programVersion: string;
  journalEntryId?: string;
}>;

export type MaintenanceForecast = Readonly<{
  aircraftId: string;
  generatedAt: string;
  programVersion: string;
  dispatchReady: boolean;
  conditionBasisPoints: number;
  dispatchReliabilityBasisPoints: number;
  due: readonly MaintenanceDueAssessment[];
  plannedWork: readonly MaintenanceWorkPackage[];
  activeFaults: readonly Readonly<{
    id: string;
    outcome: Exclude<FaultOutcome, "none">;
    groundsAircraft: boolean;
    repairDurationMinutes: number;
    repairWorkforceCapacity: number;
    explanation: string;
  }>[];
  scheduleConflicts: readonly string[];
  workforceNeeds: readonly string[];
  explanations: readonly string[];
  recoverySteps: readonly string[];
}>;

export type MaintenanceHistoryEvent = Readonly<{
  id: string;
  aircraftId: string;
  sequence: string;
  eventType: string;
  occurredAt: string;
  details: Readonly<Record<string, unknown>>;
  journalEntryId?: string;
}>;

export class MaintenanceDomainError extends Error {
  public constructor(
    readonly code:
      | "maintenance_not_found"
      | "aircraft_not_found"
      | "rule_not_found"
      | "fault_not_found"
      | "work_package_not_found"
      | "invalid_utilization"
      | "invalid_window"
      | "occupancy_conflict"
      | "workforce_shortage"
      | "dispatch_blocked"
      | "idempotency_conflict"
      | "work_not_due",
    message: string,
    readonly explanations: readonly string[] = [],
  ) {
    super(message);
    this.name = "MaintenanceDomainError";
  }
}

export interface MaintenanceRepository {
  program(
    playerAccountId: string,
    airlineId: string,
    aircraftId: string,
    now: Date,
  ): Promise<MaintenanceProgram>;
  recordFlightCompletion(
    playerAccountId: string,
    airlineId: string,
    input: FlightCompletionUtilizationInput,
    now: Date,
  ): Promise<FlightCompletionUtilizationResult>;
  scheduleWork(
    playerAccountId: string,
    airlineId: string,
    aircraftId: string,
    input: MaintenanceWindowInput,
    idempotencyKey: string,
    now: Date,
  ): Promise<MaintenanceWorkPackage>;
  completeWork(
    playerAccountId: string,
    airlineId: string,
    workPackageId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<MaintenanceWorkPackage>;
  forecast(
    playerAccountId: string,
    airlineId: string,
    aircraftId: string,
    now: Date,
  ): Promise<MaintenanceForecast>;
  dispatchReadiness(
    playerAccountId: string,
    airlineId: string,
    aircraftId: string,
    at: Date,
  ): Promise<MaintenanceForecast>;
  history(
    playerAccountId: string,
    airlineId: string,
    aircraftId: string,
  ): Promise<readonly MaintenanceHistoryEvent[]>;
}
