import type { CurrencyCode } from "./finance.js";

export type DeliveryState = "pending" | "delivered" | "returned" | "defaulted";
export type LeaseState = "active" | "returned" | "defaulted";

export type FounderPackageOption = Readonly<{
  code: string;
  packageVersion: string;
  catalogReleaseVersion: string;
  worldRulesetVersion: string;
  variant: Readonly<{
    id: string;
    code: string;
    manufacturer: string;
    model: string;
    category: "turboprop" | "regional_jet" | "narrow_body";
    rangeNm: number;
    typicalSeats: number;
    maximumSeats: number;
    minimumRunwayFt: number;
    productionStatus: "in_production" | "discontinued";
    acquisitionChannel: "operating_lease";
  }>;
  cabin: Readonly<{
    configurationKind: "physical_cabin";
    economySeats: number;
    bookingClassesConfigured: false;
  }>;
  lease: Readonly<{
    currency: CurrencyCode;
    termDays: number;
    paymentIntervalDays: number;
    paymentCount: number;
    recurringPaymentMinor: string;
    depositMinor: string;
    depositSubsidyMinor: string;
    refundableDepositMinor: string;
  }>;
  delivery: Readonly<{ delayMinutes: number; immediate: boolean; maximumDelayMinutes: 1440 }>;
  tradeoffs: Readonly<{
    network: string;
    cost: string;
    delivery: string;
    commonalityRisk: string;
    runway: string;
  }>;
  viable: true;
  provenanceNotice: string;
}>;

export type FounderPackageComparison = Readonly<{
  airlineId: string;
  careerId: string;
  packageVersion: string;
  options: readonly FounderPackageOption[];
  exactlyOneMayBeAccepted: boolean;
}>;

export type LeasePayment = Readonly<{
  paymentNumber: number;
  dueAt: string;
  amountMinor: string;
  status: "scheduled" | "paid" | "overdue" | "cancelled";
}>;

export type FounderLeasePreview = Readonly<{
  option: FounderPackageOption;
  deliveryTargetAt: string;
  principalBaseAirportId: string;
  paymentSchedule: readonly LeasePayment[];
  nextStep: "accept_founder_lease";
  nextStepGuidance: string;
}>;

export type FleetAircraft = Readonly<{
  id: string;
  serialNumber: string;
  airlineId: string | null;
  leaseId: string;
  catalogReleaseId: string;
  catalogReleaseVersion: string;
  variantId: string;
  variantCode: string;
  manufacturer: string;
  model: string;
  owner: Readonly<{ lessorId: string; name: string }>;
  operatorAirlineId: string | null;
  currentAirportId: string | null;
  plannedAirportId: string | null;
  deliveryState: DeliveryState;
  deliveryTargetAt: string;
  deliveredAt: string | null;
  manufacturedAt: string;
  chronologicalAgeSeconds: string;
  accumulatedHoursMinutes: string;
  accumulatedCycles: string;
  conditionBasisPoints: number;
  dispatchReliabilityBasisPoints: number;
  version: string;
  cabin: Readonly<{
    configurationKind: "physical_cabin";
    economySeats: number;
    premiumEconomySeats: 0;
    businessSeats: 0;
    firstSeats: 0;
    bookingClassesConfigured: false;
  }>;
  restrictions: Readonly<{ sale: true; collateral: true; cashExtraction: true }>;
}>;

export type FleetAircraftPlanningDetail = Readonly<{
  aircraft: FleetAircraft;
  lease: Readonly<{
    id: string;
    status: LeaseState;
    currency: CurrencyCode;
    startsAt: string;
    maturesAt: string;
    termDays: number;
    paymentIntervalDays: number;
    recurringPaymentMinor: string;
    paymentSchedule: readonly LeasePayment[];
  }>;
}>;

export type FounderLeaseAcceptance = Readonly<{
  airlineId: string;
  careerId: string;
  packageVersion: string;
  lease: Readonly<{
    id: string;
    status: "active";
    version: string;
    startsAt: string;
    maturesAt: string;
    currency: CurrencyCode;
    paymentSchedule: readonly LeasePayment[];
  }>;
  aircraft: FleetAircraft;
  nextStep: "await_aircraft_delivery" | "plan_first_route";
  nextStepGuidance: string;
}>;

export class FleetDomainError extends Error {
  public constructor(
    readonly code:
      | "founder_lease_already_accepted"
      | "founder_package_not_found"
      | "founder_option_not_found"
      | "founder_option_ineligible"
      | "invalid_cabin_configuration"
      | "idempotency_conflict"
      | "aircraft_not_found"
      | "aircraft_not_due"
      | "stale_aircraft_version"
      | "invalid_lease_transition"
      | "return_conditions_not_met",
    message: string,
  ) {
    super(message);
    this.name = "FleetDomainError";
  }
}

export function createLeasePaymentSchedule(
  amountMinor: bigint,
  paymentIntervalDays: number,
  paymentCount: number,
  startsAt: Date,
): readonly LeasePayment[] {
  if (amountMinor <= 0n || paymentIntervalDays < 1 || paymentCount < 1) {
    throw new Error("Lease payment terms are invalid.");
  }
  return Array.from({ length: paymentCount }, (_, index) => ({
    paymentNumber: index + 1,
    dueAt: new Date(
      startsAt.getTime() + (index + 1) * paymentIntervalDays * 86_400_000,
    ).toISOString(),
    amountMinor: amountMinor.toString(),
    status: "scheduled" as const,
  }));
}

export function chronologicalAgeSeconds(
  manufacturedAt: Date,
  initialAgeSeconds: bigint,
  now: Date,
): bigint {
  if (now < manufacturedAt) return initialAgeSeconds;
  return initialAgeSeconds + BigInt(Math.floor((now.getTime() - manufacturedAt.getTime()) / 1000));
}

export interface FleetRepository {
  listFounderPackage(playerAccountId: string, airlineId: string): Promise<FounderPackageComparison>;
  previewFounderLease(
    playerAccountId: string,
    airlineId: string,
    optionCode: string,
    now: Date,
  ): Promise<FounderLeasePreview>;
  acceptFounderLease(
    playerAccountId: string,
    airlineId: string,
    optionCode: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<FounderLeaseAcceptance>;
  listFleet(
    playerAccountId: string,
    airlineId: string,
    now: Date,
  ): Promise<readonly FleetAircraft[]>;
  getAircraft(playerAccountId: string, aircraftId: string, now: Date): Promise<FleetAircraft>;
  getAircraftPlanningDetail(
    playerAccountId: string,
    aircraftId: string,
    now: Date,
  ): Promise<FleetAircraftPlanningDetail>;
  completeDueDelivery(
    aircraftId: string,
    expectedVersion: bigint,
    now: Date,
  ): Promise<FleetAircraft>;
  transitionLease(
    leaseId: string,
    expectedAircraftVersion: bigint,
    target: "returned" | "defaulted",
    now: Date,
  ): Promise<FleetAircraft>;
}
