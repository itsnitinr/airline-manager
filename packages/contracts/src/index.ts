export type HealthResponse = Readonly<{
  service: "api" | "worker";
  status: "ok";
}>;

export type DependencyStatus = "up" | "down";

export type ReadinessResponse = Readonly<{
  service: HealthResponse["service"];
  status: "ready" | "not_ready";
  dependencies: Readonly<{
    postgres: DependencyStatus;
    redis: DependencyStatus;
  }>;
}>;

export type ErrorDetail = Readonly<{ code?: string; field?: string; issue: string }>;

export type ErrorEnvelope = Readonly<{
  error: Readonly<{
    code: string;
    message: string;
    requestId: string;
    details?: readonly ErrorDetail[];
  }>;
}>;

export type PaginationQuery = Readonly<{ cursor?: string; limit?: number }>;
export type PageMetadata = Readonly<{ nextCursor: string | null; limit: number }>;
export type SampleCommandRequest = Readonly<{ message: string }>;
export type SampleCommandResponse = Readonly<{
  message: string;
  commandId: string;
  transactionId: string;
  executedAt: string;
}>;

export type FoundingSelectionRequest = Readonly<{
  airlineName: string;
  fictionalIdentityConfirmed: boolean;
  homeJurisdiction: string;
  principalBaseIataCode: string;
  reportingCurrency: "CHF" | "EUR" | "GBP" | "JPY" | "KWD" | "USD";
  brand: Readonly<{ primaryColor: string; secondaryColor: string; logoMark: string }>;
  acceptFoundingLoan: boolean;
  worldRulesetVersion: string;
}>;

export type FounderLeaseSelectionRequest = Readonly<{ optionCode: string }>;
export type FuelQuantityRequest = Readonly<{ quantityKg: string }>;
export type FuelQuotePurchaseRequest = Readonly<{ quoteId: string }>;
export type FuelReserveRequest = Readonly<{ planningReservedKg: string }>;
export type FuelForecastRequest = Readonly<{ projectedConsumptionKg: string }>;
export type FuelCapacityUpgradeRequest = Readonly<{ tier: number }>;
export type PricingStrategyRequest = Readonly<{
  marketId: string;
  effectiveFrom: string;
  posture: "value" | "balanced" | "yield";
  baseFareMinor: string;
  minimumFareMinor: string;
  maximumFareMinor: string;
  loadFactorTargetBasisPoints: number;
  revenueTargetMinor: string;
}>;
export type CommercialFlightOfferRequest = Readonly<{
  offerId: string;
  marketId: string;
  economySellableCapacity: number;
  bookingOpensAt: string;
  departureAt: string;
  scheduledArrivalAt: string;
  durationMinutes: number;
  scheduleQualityBasisPoints: number;
  serviceQualityBasisPoints: number;
  reputationBasisPoints: number;
  sourceType: "external_dated_flight" | "ticket11_fixture";
  sourceVersion: string;
  sourceReference: string;
}>;
export type BookingRefreshRequest = Readonly<{ checkpointAt: string }>;
export type RouteCreateRequest = Readonly<{
  originIataCode: string;
  destinationIataCode: string;
  aircraftId: string;
}>;
export type TimetableActivationRequest = Readonly<{
  aircraftId: string;
  effectiveFromLocalDate: string;
  horizonDays?: number;
  legs: readonly Readonly<{
    dayOfWeek: number;
    originIataCode: string;
    destinationIataCode: string;
    departureLocalTime: string;
  }>[];
}>;
export type HorizonExtensionRequest = Readonly<{ through: string }>;
export type WorkforceHireRequest = Readonly<{
  role: "pilot" | "cabin_crew" | "line_maintenance" | "ground_handling";
  capacity: number;
  qualificationAircraftVariantId?: string;
}>;
export type WorkforceForecastRequest = Readonly<{ through: string }>;
export type WorkforceWageAccrualRequest = Readonly<{ through: string }>;
export type MaintenanceFlightCompletionRequest = Readonly<{
  completionKey: string;
  completedAt: string;
  blockMinutes: number;
  cycles: number;
  faultSeed: string;
}>;
export type MaintenanceWindowRequest = Readonly<{
  ruleCode?: string;
  faultId?: string;
  startsAt: string;
}>;
export type MaintenanceReadinessRequest = Readonly<{ at: string }>;

const exactMinorSchema = { type: "string", pattern: "^[0-9]+$" } as const;
const foundingSelectionProperties = {
  airlineName: { type: "string", minLength: 3, maxLength: 80 },
  fictionalIdentityConfirmed: { type: "boolean" },
  homeJurisdiction: { type: "string", pattern: "^[A-Z]{2}$" },
  principalBaseIataCode: { type: "string", pattern: "^[A-Z]{3}$" },
  reportingCurrency: { type: "string", enum: ["CHF", "EUR", "GBP", "JPY", "KWD", "USD"] },
  brand: {
    type: "object",
    additionalProperties: false,
    required: ["primaryColor", "secondaryColor", "logoMark"],
    properties: {
      primaryColor: { type: "string", pattern: "^#[0-9A-F]{6}$" },
      secondaryColor: { type: "string", pattern: "^#[0-9A-F]{6}$" },
      logoMark: { type: "string", pattern: "^[A-Z0-9]{1,3}$" },
    },
  },
  acceptFoundingLoan: { type: "boolean" },
  worldRulesetVersion: { type: "string", minLength: 1, maxLength: 100 },
} as const;

export const foundingSelectionRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "airlineName",
    "fictionalIdentityConfirmed",
    "homeJurisdiction",
    "principalBaseIataCode",
    "reportingCurrency",
    "brand",
    "acceptFoundingLoan",
    "worldRulesetVersion",
  ],
  properties: foundingSelectionProperties,
} as const;

const principalBaseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["airportId", "iataCode", "name", "countryCode", "stationServiceModel"],
  properties: {
    airportId: { type: "string", format: "uuid" },
    iataCode: { type: "string" },
    name: { type: "string" },
    countryCode: { type: "string" },
    stationServiceModel: { type: "string", const: "outsourced" },
  },
} as const;

const assumptionsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["included", "excludedUntilTicket09", "method"],
  properties: {
    included: { type: "array", items: { type: "string" } },
    excludedUntilTicket09: { type: "array", items: { type: "string" } },
    method: { type: "string" },
  },
} as const;

const runwaySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "currency",
    "openingCashMinor",
    "founderEquityMinor",
    "foundingLoanProceedsMinor",
    "baselineDailyObligationMinor",
    "scheduledLoanRepaymentsMinor",
    "runwayDays",
    "forecastHorizonDays",
    "assumptions",
    "explanation",
  ],
  properties: {
    currency: foundingSelectionProperties.reportingCurrency,
    openingCashMinor: exactMinorSchema,
    founderEquityMinor: exactMinorSchema,
    foundingLoanProceedsMinor: exactMinorSchema,
    baselineDailyObligationMinor: exactMinorSchema,
    scheduledLoanRepaymentsMinor: exactMinorSchema,
    runwayDays: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    forecastHorizonDays: { type: "integer", minimum: 1 },
    assumptions: assumptionsSchema,
    explanation: { type: "string" },
  },
} as const;

const financingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["founderEquityMinor", "optionalLoan"],
  properties: {
    founderEquityMinor: exactMinorSchema,
    optionalLoan: {
      type: "object",
      additionalProperties: false,
      required: [
        "principalMinor",
        "annualRateBasisPoints",
        "termDays",
        "installmentCount",
        "selected",
        "schedule",
      ],
      properties: {
        principalMinor: exactMinorSchema,
        annualRateBasisPoints: { type: "integer", minimum: 0 },
        termDays: { type: "integer", minimum: 1 },
        installmentCount: { type: "integer", minimum: 1 },
        selected: { type: "boolean" },
        schedule: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "installmentNumber",
              "dueAt",
              "principalMinor",
              "interestMinor",
              "totalMinor",
            ],
            properties: {
              installmentNumber: { type: "integer", minimum: 1 },
              dueAt: { type: "string", format: "date-time" },
              principalMinor: exactMinorSchema,
              interestMinor: exactMinorSchema,
              totalMinor: exactMinorSchema,
            },
          },
        },
      },
    },
  },
} as const;

const foundingPreviewProperties = {
  normalizedAirlineName: { type: "string" },
  catalogReleaseVersion: { type: "string" },
  worldRulesetVersion: { type: "string" },
  foundingBalanceVersion: { type: "string" },
  principalBase: principalBaseSchema,
  financing: financingSchema,
  runway: runwaySchema,
  nextStep: { type: "string", const: "select_founder_aircraft" },
  nextStepGuidance: { type: "string" },
} as const;

const foundingPreviewRequired = [
  "normalizedAirlineName",
  "catalogReleaseVersion",
  "worldRulesetVersion",
  "foundingBalanceVersion",
  "principalBase",
  "financing",
  "runway",
  "nextStep",
  "nextStepGuidance",
] as const;

export const foundingPreviewResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: foundingPreviewRequired,
  properties: foundingPreviewProperties,
} as const;

export const foundingConfirmationResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    ...foundingPreviewRequired,
    "careerId",
    "airlineId",
    "stationId",
    "ledgerBookId",
    "careerStatus",
    "foundedAt",
  ],
  properties: {
    ...foundingPreviewProperties,
    careerId: { type: "string", format: "uuid" },
    airlineId: { type: "string", format: "uuid" },
    stationId: { type: "string", format: "uuid" },
    ledgerBookId: { type: "string", format: "uuid" },
    careerStatus: { type: "string", const: "active" },
    foundedAt: { type: "string", format: "date-time" },
  },
} as const;

export const airlineIdentifierParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["airlineId"],
  properties: { airlineId: { type: "string", format: "uuid" } },
} as const;

export const airlineSummaryResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "careerId",
    "airlineId",
    "name",
    "normalizedAirlineName",
    "brand",
    "careerStatus",
    "airlineStatus",
    "homeJurisdiction",
    "reportingCurrency",
    "catalogReleaseVersion",
    "worldRulesetVersion",
    "foundingBalanceVersion",
    "principalBase",
    "cashMinor",
    "equityMinor",
    "loanLiabilityMinor",
    "nextStep",
    "nextStepGuidance",
  ],
  properties: {
    careerId: { type: "string", format: "uuid" },
    airlineId: { type: "string", format: "uuid" },
    name: { type: "string" },
    normalizedAirlineName: { type: "string" },
    brand: foundingSelectionProperties.brand,
    careerStatus: { type: "string", enum: ["active", "insolvent", "closed"] },
    airlineStatus: { type: "string", enum: ["active", "insolvent", "closed"] },
    homeJurisdiction: { type: "string" },
    reportingCurrency: foundingSelectionProperties.reportingCurrency,
    catalogReleaseVersion: { type: "string" },
    worldRulesetVersion: { type: "string" },
    foundingBalanceVersion: { type: "string" },
    principalBase: principalBaseSchema,
    cashMinor: exactMinorSchema,
    equityMinor: exactMinorSchema,
    loanLiabilityMinor: exactMinorSchema,
    nextStep: { type: "string", const: "select_founder_aircraft" },
    nextStepGuidance: { type: "string" },
  },
} as const;

export const currentPlayerCareerResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["career"],
  properties: { career: { ...airlineSummaryResponseSchema, nullable: true } },
} as const;

const fieldProvenanceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["fieldName", "classification", "effectiveFrom", "explanation"],
  properties: {
    fieldName: { type: "string" },
    classification: { type: "string", enum: ["sourced", "derived", "balance"] },
    sourceId: { type: "string" },
    sourceLocator: { type: "string", format: "uri" },
    effectiveFrom: { type: "string", format: "date" },
    formulaVersion: { type: "string" },
    rulesetVersion: { type: "string" },
    explanation: { type: "string" },
  },
} as const;

const catalogAirportSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "ident",
    "iataCode",
    "icaoCode",
    "name",
    "municipality",
    "countryCode",
    "regionCode",
    "worldRegion",
    "latitudeDeg",
    "longitudeDeg",
    "timezoneName",
    "longestRunwayFt",
    "provenance",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    ident: { type: "string" },
    iataCode: { type: "string", pattern: "^[A-Z]{3}$" },
    icaoCode: { type: "string", pattern: "^[A-Z0-9]{4}$" },
    name: { type: "string" },
    municipality: { type: "string" },
    countryCode: { type: "string", pattern: "^[A-Z]{2}$" },
    regionCode: { type: "string" },
    worldRegion: { type: "string" },
    latitudeDeg: { type: "string", pattern: "^-?[0-9]+(?:\\.[0-9]+)?$" },
    longitudeDeg: { type: "string", pattern: "^-?[0-9]+(?:\\.[0-9]+)?$" },
    elevationFt: {
      anyOf: [{ type: "integer" }, { type: "string", pattern: "^-?[0-9]+$" }],
    },
    timezoneName: { type: "string" },
    longestRunwayFt: { type: "integer", minimum: 1 },
    provenance: { type: "array", items: fieldProvenanceSchema },
  },
} as const;

const catalogAircraftVariantSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "code",
    "manufacturer",
    "model",
    "certificationReference",
    "category",
    "typicalSeats",
    "maximumSeats",
    "rangeNm",
    "maximumTakeoffWeightKg",
    "minimumRunwayFt",
    "productionStatus",
    "acquisitionChannels",
    "provenance",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    code: { type: "string" },
    manufacturer: { type: "string" },
    model: { type: "string" },
    certificationReference: { type: "string" },
    category: { type: "string", enum: ["turboprop", "regional_jet", "narrow_body"] },
    typicalSeats: { type: "integer", minimum: 1 },
    maximumSeats: { type: "integer", minimum: 1 },
    rangeNm: { type: "integer", minimum: 1 },
    maximumTakeoffWeightKg: { type: "integer", minimum: 1 },
    minimumRunwayFt: { type: "integer", minimum: 1 },
    productionStatus: { type: "string", enum: ["in_production", "discontinued"] },
    acquisitionChannels: {
      type: "array",
      items: { type: "string", enum: ["factory_new", "operating_lease", "used_purchase"] },
    },
    provenance: { type: "array", items: fieldProvenanceSchema },
  },
} as const;

export const currentCatalogResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["releaseVersion", "worldRulesetVersion", "airports", "aircraftVariants"],
  properties: {
    releaseVersion: { type: "string" },
    worldRulesetVersion: { type: "string" },
    airports: { type: "array", items: catalogAirportSchema },
    aircraftVariants: { type: "array", items: catalogAircraftVariantSchema },
  },
} as const;

export const publicConfigResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["googleSignInAvailable"],
  properties: { googleSignInAvailable: { type: "boolean" } },
} as const;

export const aircraftIdentifierParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["airlineId", "aircraftId"],
  properties: {
    airlineId: { type: "string", format: "uuid" },
    aircraftId: { type: "string", format: "uuid" },
  },
} as const;

export const founderLeaseSelectionRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["optionCode"],
  properties: { optionCode: { type: "string", pattern: "^founder-[a-z0-9-]+$" } },
} as const;

const exactIntegerStringSchema = { type: "string", pattern: "^-?[0-9]+$" } as const;
const exactPositiveStringSchema = { type: "string", pattern: "^[1-9][0-9]*$" } as const;
const fuelCurrencySchema = {
  type: "string",
  enum: ["CHF", "EUR", "GBP", "JPY", "KWD", "USD"],
} as const;

export const fuelQuantityRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["quantityKg"],
  properties: { quantityKg: exactPositiveStringSchema },
} as const;
export const fuelQuotePurchaseRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["quoteId"],
  properties: { quoteId: { type: "string", format: "uuid" } },
} as const;
export const fuelReserveRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["planningReservedKg"],
  properties: { planningReservedKg: exactMinorSchema },
} as const;
export const fuelForecastRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["projectedConsumptionKg"],
  properties: { projectedConsumptionKg: exactMinorSchema },
} as const;
export const fuelCapacityUpgradeRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["tier"],
  properties: { tier: { type: "integer", minimum: 2 } },
} as const;

export const fuelPriceResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "currency",
    "bucketStart",
    "bucketEnd",
    "unit",
    "unitPriceNumerator",
    "unitPriceDenominator",
    "pricePerTonneMinor",
    "rulesetVersion",
    "fuelRulesVersion",
    "priceFormulaVersion",
  ],
  properties: {
    currency: fuelCurrencySchema,
    bucketStart: { type: "string", format: "date-time" },
    bucketEnd: { type: "string", format: "date-time" },
    unit: { type: "string", const: "kg" },
    unitPriceNumerator: exactPositiveStringSchema,
    unitPriceDenominator: exactPositiveStringSchema,
    pricePerTonneMinor: exactPositiveStringSchema,
    rulesetVersion: { type: "string" },
    fuelRulesVersion: { type: "string" },
    priceFormulaVersion: { type: "string" },
  },
} as const;
export const fuelPricesResponseSchema = { type: "array", items: fuelPriceResponseSchema } as const;

export const fuelQuoteResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "airlineId",
    "quantityKg",
    "currency",
    "unitPriceNumerator",
    "unitPriceDenominator",
    "totalPriceMinor",
    "rulesetVersion",
    "priceFormulaVersion",
    "bucketStart",
    "createdAt",
    "expiresAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    airlineId: { type: "string", format: "uuid" },
    quantityKg: exactPositiveStringSchema,
    currency: fuelCurrencySchema,
    unitPriceNumerator: exactPositiveStringSchema,
    unitPriceDenominator: exactPositiveStringSchema,
    totalPriceMinor: exactPositiveStringSchema,
    rulesetVersion: { type: "string" },
    priceFormulaVersion: { type: "string" },
    bucketStart: { type: "string", format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    expiresAt: { type: "string", format: "date-time" },
  },
} as const;

export const fuelInventoryResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "airlineId",
    "unit",
    "onHandKg",
    "planningReservedKg",
    "minimumReserveKg",
    "protectedKg",
    "availableKg",
    "capacityKg",
    "capacityTier",
    "utilizationBasisPoints",
    "inventoryValueMinor",
    "currency",
    "weightedUnitCostNumerator",
    "weightedUnitCostDenominator",
    "version",
  ],
  properties: {
    airlineId: { type: "string", format: "uuid" },
    unit: { type: "string", const: "kg" },
    onHandKg: exactMinorSchema,
    planningReservedKg: exactMinorSchema,
    minimumReserveKg: exactMinorSchema,
    protectedKg: exactMinorSchema,
    availableKg: exactMinorSchema,
    capacityKg: exactPositiveStringSchema,
    capacityTier: { type: "integer", minimum: 1 },
    utilizationBasisPoints: exactMinorSchema,
    inventoryValueMinor: exactMinorSchema,
    currency: fuelCurrencySchema,
    weightedUnitCostNumerator: exactMinorSchema,
    weightedUnitCostDenominator: exactPositiveStringSchema,
    version: exactPositiveStringSchema,
  },
} as const;

export const fuelLotResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "quoteId",
    "quantityKg",
    "costBasisMinor",
    "derivedRemainingQuantityKg",
    "derivedRemainingCostMinor",
    "currency",
    "unitPriceNumerator",
    "unitPriceDenominator",
    "fuelRulesVersion",
    "priceFormulaVersion",
    "appliedFxSnapshot",
    "purchasedAt",
    "provenance",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    quoteId: { type: "string", format: "uuid" },
    quantityKg: exactPositiveStringSchema,
    costBasisMinor: exactPositiveStringSchema,
    derivedRemainingQuantityKg: exactMinorSchema,
    derivedRemainingCostMinor: exactMinorSchema,
    currency: fuelCurrencySchema,
    unitPriceNumerator: exactPositiveStringSchema,
    unitPriceDenominator: exactPositiveStringSchema,
    fuelRulesVersion: { type: "string" },
    priceFormulaVersion: { type: "string" },
    appliedFxSnapshot: {
      type: "object",
      additionalProperties: false,
      required: ["importId", "numerator", "denominator"],
      properties: {
        importId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
        numerator: exactPositiveStringSchema,
        denominator: exactPositiveStringSchema,
      },
    },
    purchasedAt: { type: "string", format: "date-time" },
    provenance: { type: "object", additionalProperties: true },
  },
} as const;
export const fuelLotsResponseSchema = { type: "array", items: fuelLotResponseSchema } as const;

export const fuelMovementResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "type",
    "quantityDeltaKg",
    "reservedDeltaKg",
    "inventoryValueDeltaMinor",
    "balanceAfterKg",
    "reservedAfterKg",
    "inventoryValueAfterMinor",
    "sourceType",
    "sourceId",
    "reversesMovementId",
    "occurredAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    type: {
      type: "string",
      enum: [
        "purchase",
        "consumption",
        "reservation",
        "release",
        "correction",
        "reversal",
        "capacity_adjustment",
      ],
    },
    quantityDeltaKg: exactIntegerStringSchema,
    reservedDeltaKg: exactIntegerStringSchema,
    inventoryValueDeltaMinor: exactIntegerStringSchema,
    balanceAfterKg: exactMinorSchema,
    reservedAfterKg: exactMinorSchema,
    inventoryValueAfterMinor: exactMinorSchema,
    sourceType: { type: "string" },
    sourceId: { type: "string" },
    reversesMovementId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
    occurredAt: { type: "string", format: "date-time" },
  },
} as const;
export const fuelMovementsResponseSchema = {
  type: "array",
  items: fuelMovementResponseSchema,
} as const;

export const fuelPurchaseResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["quote", "lot", "inventory", "journalEntryId", "movementId"],
  properties: {
    quote: fuelQuoteResponseSchema,
    lot: fuelLotResponseSchema,
    inventory: fuelInventoryResponseSchema,
    journalEntryId: { type: "string", format: "uuid" },
    movementId: { type: "string", format: "uuid" },
  },
} as const;

export const fuelForecastResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "airlineId",
    "onHandKg",
    "planningReservedKg",
    "minimumReserveKg",
    "projectedConsumptionKg",
    "projectedOnHandKg",
    "projectedAvailableKg",
    "projectedShortageKg",
    "advisoryOnly",
  ],
  properties: {
    airlineId: { type: "string", format: "uuid" },
    onHandKg: exactMinorSchema,
    planningReservedKg: exactMinorSchema,
    minimumReserveKg: exactMinorSchema,
    projectedConsumptionKg: exactMinorSchema,
    projectedOnHandKg: exactMinorSchema,
    projectedAvailableKg: exactMinorSchema,
    projectedShortageKg: exactMinorSchema,
    advisoryOnly: { type: "boolean", const: true },
  },
} as const;

export const fuelCapacityOfferResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "tier",
    "capacityKg",
    "incrementalCapacityKg",
    "currency",
    "priceMinor",
    "fuelRulesVersion",
  ],
  properties: {
    tier: { type: "integer", minimum: 2 },
    capacityKg: exactPositiveStringSchema,
    incrementalCapacityKg: exactPositiveStringSchema,
    currency: fuelCurrencySchema,
    priceMinor: exactPositiveStringSchema,
    fuelRulesVersion: { type: "string" },
  },
} as const;
export const fuelCapacityOffersResponseSchema = {
  type: "array",
  items: fuelCapacityOfferResponseSchema,
} as const;
export const fuelCapacityUpgradeResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "airlineId",
    "fromTier",
    "toTier",
    "capacityKg",
    "priceMinor",
    "currency",
    "journalEntryId",
    "inventory",
  ],
  properties: {
    airlineId: { type: "string", format: "uuid" },
    fromTier: { type: "integer", minimum: 1 },
    toTier: { type: "integer", minimum: 2 },
    capacityKg: exactPositiveStringSchema,
    priceMinor: exactPositiveStringSchema,
    currency: fuelCurrencySchema,
    journalEntryId: { type: "string", format: "uuid" },
    inventory: fuelInventoryResponseSchema,
  },
} as const;

const founderVariantSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "code",
    "manufacturer",
    "model",
    "category",
    "rangeNm",
    "typicalSeats",
    "maximumSeats",
    "minimumRunwayFt",
    "productionStatus",
    "acquisitionChannel",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    code: { type: "string" },
    manufacturer: { type: "string" },
    model: { type: "string" },
    category: { type: "string", enum: ["turboprop", "regional_jet", "narrow_body"] },
    rangeNm: { type: "integer", minimum: 1 },
    typicalSeats: { type: "integer", minimum: 1 },
    maximumSeats: { type: "integer", minimum: 1 },
    minimumRunwayFt: { type: "integer", minimum: 1 },
    productionStatus: { type: "string", enum: ["in_production", "discontinued"] },
    acquisitionChannel: { type: "string", const: "operating_lease" },
  },
} as const;

const founderOptionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "code",
    "packageVersion",
    "catalogReleaseVersion",
    "worldRulesetVersion",
    "variant",
    "cabin",
    "lease",
    "delivery",
    "tradeoffs",
    "viable",
    "provenanceNotice",
  ],
  properties: {
    code: { type: "string" },
    packageVersion: { type: "string" },
    catalogReleaseVersion: { type: "string" },
    worldRulesetVersion: { type: "string" },
    variant: founderVariantSchema,
    cabin: {
      type: "object",
      additionalProperties: false,
      required: ["configurationKind", "economySeats", "bookingClassesConfigured"],
      properties: {
        configurationKind: { type: "string", const: "physical_cabin" },
        economySeats: { type: "integer", minimum: 1 },
        bookingClassesConfigured: { type: "boolean", const: false },
      },
    },
    lease: {
      type: "object",
      additionalProperties: false,
      required: [
        "currency",
        "termDays",
        "paymentIntervalDays",
        "paymentCount",
        "recurringPaymentMinor",
        "depositMinor",
        "depositSubsidyMinor",
        "refundableDepositMinor",
      ],
      properties: {
        currency: foundingSelectionProperties.reportingCurrency,
        termDays: { type: "integer", minimum: 1 },
        paymentIntervalDays: { type: "integer", minimum: 1 },
        paymentCount: { type: "integer", minimum: 1 },
        recurringPaymentMinor: exactMinorSchema,
        depositMinor: exactMinorSchema,
        depositSubsidyMinor: exactMinorSchema,
        refundableDepositMinor: exactMinorSchema,
      },
    },
    delivery: {
      type: "object",
      additionalProperties: false,
      required: ["delayMinutes", "immediate", "maximumDelayMinutes"],
      properties: {
        delayMinutes: { type: "integer", minimum: 0, maximum: 1440 },
        immediate: { type: "boolean" },
        maximumDelayMinutes: { type: "integer", const: 1440 },
      },
    },
    tradeoffs: {
      type: "object",
      additionalProperties: false,
      required: ["network", "cost", "delivery", "commonalityRisk", "runway"],
      properties: {
        network: { type: "string" },
        cost: { type: "string" },
        delivery: { type: "string" },
        commonalityRisk: { type: "string" },
        runway: { type: "string" },
      },
    },
    viable: { type: "boolean", const: true },
    provenanceNotice: { type: "string" },
  },
} as const;

const leasePaymentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["paymentNumber", "dueAt", "amountMinor", "status"],
  properties: {
    paymentNumber: { type: "integer", minimum: 1 },
    dueAt: { type: "string", format: "date-time" },
    amountMinor: exactMinorSchema,
    status: { type: "string", enum: ["scheduled", "paid", "overdue", "cancelled"] },
  },
} as const;

export const founderPackageComparisonResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["airlineId", "careerId", "packageVersion", "options", "exactlyOneMayBeAccepted"],
  properties: {
    airlineId: { type: "string", format: "uuid" },
    careerId: { type: "string", format: "uuid" },
    packageVersion: { type: "string" },
    options: { type: "array", minItems: 4, maxItems: 4, items: founderOptionSchema },
    exactlyOneMayBeAccepted: { type: "boolean", const: true },
  },
} as const;

export const founderLeasePreviewResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "option",
    "deliveryTargetAt",
    "principalBaseAirportId",
    "paymentSchedule",
    "nextStep",
    "nextStepGuidance",
  ],
  properties: {
    option: founderOptionSchema,
    deliveryTargetAt: { type: "string", format: "date-time" },
    principalBaseAirportId: { type: "string", format: "uuid" },
    paymentSchedule: { type: "array", items: leasePaymentSchema },
    nextStep: { type: "string", const: "accept_founder_lease" },
    nextStepGuidance: { type: "string" },
  },
} as const;

const fleetAircraftSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "serialNumber",
    "airlineId",
    "leaseId",
    "catalogReleaseId",
    "catalogReleaseVersion",
    "variantId",
    "variantCode",
    "manufacturer",
    "model",
    "owner",
    "operatorAirlineId",
    "currentAirportId",
    "plannedAirportId",
    "deliveryState",
    "deliveryTargetAt",
    "deliveredAt",
    "manufacturedAt",
    "chronologicalAgeSeconds",
    "accumulatedHoursMinutes",
    "accumulatedCycles",
    "conditionBasisPoints",
    "dispatchReliabilityBasisPoints",
    "version",
    "cabin",
    "restrictions",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    serialNumber: { type: "string" },
    airlineId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
    leaseId: { type: "string", format: "uuid" },
    catalogReleaseId: { type: "string", format: "uuid" },
    catalogReleaseVersion: { type: "string" },
    variantId: { type: "string", format: "uuid" },
    variantCode: { type: "string" },
    manufacturer: { type: "string" },
    model: { type: "string" },
    owner: {
      type: "object",
      additionalProperties: false,
      required: ["lessorId", "name"],
      properties: { lessorId: { type: "string", format: "uuid" }, name: { type: "string" } },
    },
    operatorAirlineId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
    currentAirportId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
    plannedAirportId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
    deliveryState: { type: "string", enum: ["pending", "delivered", "returned", "defaulted"] },
    deliveryTargetAt: { type: "string", format: "date-time" },
    deliveredAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
    manufacturedAt: { type: "string", format: "date-time" },
    chronologicalAgeSeconds: exactMinorSchema,
    accumulatedHoursMinutes: exactMinorSchema,
    accumulatedCycles: exactMinorSchema,
    conditionBasisPoints: { type: "integer", minimum: 0, maximum: 10000 },
    dispatchReliabilityBasisPoints: { type: "integer", minimum: 0, maximum: 10000 },
    version: exactMinorSchema,
    cabin: {
      type: "object",
      additionalProperties: false,
      required: [
        "configurationKind",
        "economySeats",
        "premiumEconomySeats",
        "businessSeats",
        "firstSeats",
        "bookingClassesConfigured",
      ],
      properties: {
        configurationKind: { type: "string", const: "physical_cabin" },
        economySeats: { type: "integer", minimum: 1 },
        premiumEconomySeats: { type: "integer", const: 0 },
        businessSeats: { type: "integer", const: 0 },
        firstSeats: { type: "integer", const: 0 },
        bookingClassesConfigured: { type: "boolean", const: false },
      },
    },
    restrictions: {
      type: "object",
      additionalProperties: false,
      required: ["sale", "collateral", "cashExtraction"],
      properties: {
        sale: { type: "boolean", const: true },
        collateral: { type: "boolean", const: true },
        cashExtraction: { type: "boolean", const: true },
      },
    },
  },
} as const;

export const fleetListResponseSchema = { type: "array", items: fleetAircraftSchema } as const;
export const fleetAircraftResponseSchema = fleetAircraftSchema;
export const fleetAircraftPlanningResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["aircraft", "lease"],
  properties: {
    aircraft: fleetAircraftSchema,
    lease: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "status",
        "currency",
        "startsAt",
        "maturesAt",
        "termDays",
        "paymentIntervalDays",
        "recurringPaymentMinor",
        "paymentSchedule",
      ],
      properties: {
        id: { type: "string", format: "uuid" },
        status: { type: "string", enum: ["active", "returned", "defaulted"] },
        currency: { type: "string" },
        startsAt: { type: "string", format: "date-time" },
        maturesAt: { type: "string", format: "date-time" },
        termDays: { type: "integer", minimum: 1 },
        paymentIntervalDays: { type: "integer", minimum: 1 },
        recurringPaymentMinor: exactMinorSchema,
        paymentSchedule: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["paymentNumber", "dueAt", "amountMinor", "status"],
            properties: {
              paymentNumber: { type: "integer", minimum: 1 },
              dueAt: { type: "string", format: "date-time" },
              amountMinor: exactMinorSchema,
              status: {
                type: "string",
                enum: ["scheduled", "paid", "overdue", "cancelled"],
              },
            },
          },
        },
      },
    },
  },
} as const;

const marketIdentifierSchema = { type: "string", format: "uuid" } as const;
const dateTimeSchema = { type: "string", format: "date-time" } as const;
const basisPointsSchema = { type: "integer", minimum: 0, maximum: 10000 } as const;

export const marketResearchQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["origin", "destination"],
  properties: {
    origin: { type: "string", pattern: "^[A-Z]{3}$" },
    destination: { type: "string", pattern: "^[A-Z]{3}$" },
    at: dateTimeSchema,
  },
} as const;

export const marketResearchResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["marketId", "forecast", "competition", "recommendedPricing", "explanation"],
  properties: {
    marketId: marketIdentifierSchema,
    forecast: {
      type: "object",
      additionalProperties: true,
      required: [
        "marketKey",
        "originIataCode",
        "destinationIataCode",
        "distanceNm",
        "generatedAt",
        "segments",
        "uncertaintyBasisPoints",
      ],
      properties: {
        marketKey: { type: "string" },
        originIataCode: { type: "string" },
        destinationIataCode: { type: "string" },
        distanceNm: { type: "integer" },
        generatedAt: dateTimeSchema,
        segments: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["segment", "dailyDemand", "sensitivity"],
            properties: {
              segment: { type: "string", enum: ["business", "leisure", "vfr"] },
              dailyDemand: { type: "string" },
              sensitivity: {
                type: "object",
                additionalProperties: true,
                required: ["explanation"],
                properties: { explanation: { type: "string" } },
              },
            },
          },
        },
        uncertaintyBasisPoints: basisPointsSchema,
      },
    },
    competition: {
      type: "object",
      additionalProperties: false,
      required: [
        "asOf",
        "bucket",
        "capacitySeats",
        "farePressureBasisPoints",
        "scheduleQualityBasisPoints",
        "frequencyPerWeek",
        "serviceQualityBasisPoints",
        "formulaVersion",
        "classification",
        "explanation",
      ],
      properties: {
        asOf: dateTimeSchema,
        bucket: { type: "string" },
        capacitySeats: { type: "string" },
        farePressureBasisPoints: basisPointsSchema,
        scheduleQualityBasisPoints: basisPointsSchema,
        frequencyPerWeek: { type: "integer" },
        serviceQualityBasisPoints: basisPointsSchema,
        formulaVersion: { type: "string" },
        classification: { type: "string", const: "simulated_aggregate_market_pressure" },
        explanation: { type: "string" },
      },
    },
    recommendedPricing: {
      type: "object",
      additionalProperties: true,
      required: [
        "airlineId",
        "marketId",
        "effectiveFrom",
        "posture",
        "currency",
        "baseFareMinor",
        "minimumFareMinor",
        "maximumFareMinor",
        "loadFactorTargetBasisPoints",
        "revenueTargetMinor",
        "formulaVersion",
        "recommendation",
      ],
      properties: {
        airlineId: { type: "string", format: "uuid" },
        marketId: marketIdentifierSchema,
        effectiveFrom: dateTimeSchema,
        posture: { type: "string", enum: ["value", "balanced", "yield"] },
        currency: { type: "string" },
        baseFareMinor: exactMinorSchema,
        minimumFareMinor: exactMinorSchema,
        maximumFareMinor: exactMinorSchema,
        loadFactorTargetBasisPoints: basisPointsSchema,
        revenueTargetMinor: exactMinorSchema,
        formulaVersion: { type: "string" },
        recommendation: { type: "string" },
      },
    },
    explanation: { type: "array", items: { type: "string" } },
  },
} as const;

export const pricingStrategyRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "marketId",
    "effectiveFrom",
    "posture",
    "baseFareMinor",
    "minimumFareMinor",
    "maximumFareMinor",
    "loadFactorTargetBasisPoints",
    "revenueTargetMinor",
  ],
  properties: {
    marketId: marketIdentifierSchema,
    effectiveFrom: dateTimeSchema,
    posture: { type: "string", enum: ["value", "balanced", "yield"] },
    baseFareMinor: exactMinorSchema,
    minimumFareMinor: exactMinorSchema,
    maximumFareMinor: exactMinorSchema,
    loadFactorTargetBasisPoints: { type: "integer", minimum: 1000, maximum: 10000 },
    revenueTargetMinor: exactMinorSchema,
  },
} as const;

export const pricingStrategyResponseSchema = {
  type: "object",
  additionalProperties: true,
  required: [
    "id",
    "airlineId",
    "marketId",
    "version",
    "effectiveFrom",
    "effectiveTo",
    "posture",
    "currency",
    "baseFareMinor",
    "minimumFareMinor",
    "maximumFareMinor",
    "loadFactorTargetBasisPoints",
    "revenueTargetMinor",
    "formulaVersion",
    "recommendation",
  ],
  properties: {
    id: marketIdentifierSchema,
    airlineId: marketIdentifierSchema,
    marketId: marketIdentifierSchema,
    version: { type: "integer", minimum: 1 },
    effectiveFrom: dateTimeSchema,
    effectiveTo: { anyOf: [dateTimeSchema, { type: "null" }] },
    posture: pricingStrategyRequestSchema.properties.posture,
    currency: foundingSelectionProperties.reportingCurrency,
    baseFareMinor: exactMinorSchema,
    minimumFareMinor: exactMinorSchema,
    maximumFareMinor: exactMinorSchema,
    loadFactorTargetBasisPoints:
      pricingStrategyRequestSchema.properties.loadFactorTargetBasisPoints,
    revenueTargetMinor: exactMinorSchema,
    formulaVersion: { type: "string" },
    recommendation: { type: "string" },
  },
} as const;

export const pricingStrategiesResponseSchema = {
  type: "array",
  items: pricingStrategyResponseSchema,
} as const;

export const marketIdentifierParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["airlineId", "marketId"],
  properties: { airlineId: marketIdentifierSchema, marketId: marketIdentifierSchema },
} as const;

export const commercialOfferIdentifierParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["airlineId", "offerId"],
  properties: { airlineId: marketIdentifierSchema, offerId: marketIdentifierSchema },
} as const;

export const commercialFlightOfferRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "offerId",
    "marketId",
    "economySellableCapacity",
    "bookingOpensAt",
    "departureAt",
    "scheduledArrivalAt",
    "durationMinutes",
    "scheduleQualityBasisPoints",
    "serviceQualityBasisPoints",
    "reputationBasisPoints",
    "sourceType",
    "sourceVersion",
    "sourceReference",
  ],
  properties: {
    offerId: marketIdentifierSchema,
    marketId: marketIdentifierSchema,
    economySellableCapacity: { type: "integer", minimum: 1, maximum: 1000 },
    bookingOpensAt: dateTimeSchema,
    departureAt: dateTimeSchema,
    scheduledArrivalAt: dateTimeSchema,
    durationMinutes: { type: "integer", minimum: 1, maximum: 1440 },
    scheduleQualityBasisPoints: basisPointsSchema,
    serviceQualityBasisPoints: basisPointsSchema,
    reputationBasisPoints: basisPointsSchema,
    sourceType: { type: "string", enum: ["external_dated_flight", "ticket11_fixture"] },
    sourceVersion: { type: "string", minLength: 1, maxLength: 100 },
    sourceReference: { type: "string", minLength: 1, maxLength: 200 },
  },
} as const;

export const commercialFlightOfferResponseSchema = {
  type: "object",
  additionalProperties: true,
  required: [
    ...commercialFlightOfferRequestSchema.required,
    "airlineId",
    "bookedPassengers",
    "realizedRevenueMinor",
    "lastCheckpointAt",
    "version",
  ],
  properties: {
    ...commercialFlightOfferRequestSchema.properties,
    airlineId: marketIdentifierSchema,
    bookedPassengers: exactMinorSchema,
    realizedRevenueMinor: exactMinorSchema,
    lastCheckpointAt: dateTimeSchema,
    version: exactMinorSchema,
  },
} as const;

export const bookingRefreshRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["checkpointAt"],
  properties: { checkpointAt: dateTimeSchema },
} as const;

export const bookingCheckpointResponseSchema = {
  type: "object",
  additionalProperties: true,
  required: [
    "id",
    "offerId",
    "intervalStart",
    "intervalEnd",
    "pricingStrategyId",
    "pricingStrategyVersion",
    "passengersAdded",
    "revenueAddedMinor",
    "cumulativePassengers",
    "cumulativeRevenueMinor",
    "aggregates",
    "materialInputSnapshot",
  ],
  properties: {
    id: marketIdentifierSchema,
    offerId: marketIdentifierSchema,
    intervalStart: dateTimeSchema,
    intervalEnd: dateTimeSchema,
    pricingStrategyId: marketIdentifierSchema,
    pricingStrategyVersion: { type: "integer", minimum: 1 },
    passengersAdded: exactMinorSchema,
    revenueAddedMinor: exactMinorSchema,
    cumulativePassengers: exactMinorSchema,
    cumulativeRevenueMinor: exactMinorSchema,
    aggregates: { type: "array", items: { type: "object", additionalProperties: true } },
    materialInputSnapshot: { type: "object", additionalProperties: true },
  },
} as const;

export const commercialOfferAnalyticsResponseSchema = {
  type: "object",
  additionalProperties: true,
  required: [
    "offer",
    "bookingPacePassengersPerDay",
    "loadFactorBasisPoints",
    "yieldMinorPerPassenger",
    "segmentMix",
    "competition",
    "aggregates",
    "checkpoints",
    "explanation",
    "ledgerRevenuePosted",
  ],
  properties: {
    offer: commercialFlightOfferResponseSchema,
    bookingPacePassengersPerDay: exactMinorSchema,
    loadFactorBasisPoints: exactMinorSchema,
    yieldMinorPerPassenger: exactMinorSchema,
    segmentMix: { type: "object", additionalProperties: exactMinorSchema },
    competition: { type: "object", additionalProperties: true },
    aggregates: { type: "array", items: { type: "object", additionalProperties: true } },
    checkpoints: { type: "array", items: bookingCheckpointResponseSchema },
    explanation: { type: "array", items: { type: "string" } },
    ledgerRevenuePosted: { type: "boolean", const: false },
  },
} as const;
export const deliveryStatusResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "aircraftId",
    "deliveryState",
    "deliveryTargetAt",
    "deliveredAt",
    "currentAirportId",
    "plannedAirportId",
    "version",
  ],
  properties: {
    aircraftId: { type: "string", format: "uuid" },
    deliveryState: fleetAircraftSchema.properties.deliveryState,
    deliveryTargetAt: fleetAircraftSchema.properties.deliveryTargetAt,
    deliveredAt: fleetAircraftSchema.properties.deliveredAt,
    currentAirportId: fleetAircraftSchema.properties.currentAirportId,
    plannedAirportId: fleetAircraftSchema.properties.plannedAirportId,
    version: exactMinorSchema,
  },
} as const;

export const founderLeaseAcceptanceResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "airlineId",
    "careerId",
    "packageVersion",
    "lease",
    "aircraft",
    "nextStep",
    "nextStepGuidance",
  ],
  properties: {
    airlineId: { type: "string", format: "uuid" },
    careerId: { type: "string", format: "uuid" },
    packageVersion: { type: "string" },
    lease: {
      type: "object",
      additionalProperties: false,
      required: ["id", "status", "version", "startsAt", "maturesAt", "currency", "paymentSchedule"],
      properties: {
        id: { type: "string", format: "uuid" },
        status: { type: "string", const: "active" },
        version: exactMinorSchema,
        startsAt: { type: "string", format: "date-time" },
        maturesAt: { type: "string", format: "date-time" },
        currency: foundingSelectionProperties.reportingCurrency,
        paymentSchedule: { type: "array", items: leasePaymentSchema },
      },
    },
    aircraft: fleetAircraftSchema,
    nextStep: { type: "string", enum: ["await_aircraft_delivery", "plan_first_route"] },
    nextStepGuidance: { type: "string" },
  },
} as const;

export const healthResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["service", "status"],
  properties: {
    service: { type: "string", enum: ["api", "worker"] },
    status: { type: "string", const: "ok" },
  },
} as const;

export const readinessResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["service", "status", "dependencies"],
  properties: {
    service: { type: "string", enum: ["api", "worker"] },
    status: { type: "string", enum: ["ready", "not_ready"] },
    dependencies: {
      type: "object",
      additionalProperties: false,
      required: ["postgres", "redis"],
      properties: {
        postgres: { type: "string", enum: ["up", "down"] },
        redis: { type: "string", enum: ["up", "down"] },
      },
    },
  },
} as const;

export const errorEnvelopeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message", "requestId"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        requestId: { type: "string" },
        details: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["issue"],
            properties: {
              code: { type: "string" },
              field: { type: "string" },
              issue: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

export const idempotencyHeadersSchema = {
  type: "object",
  additionalProperties: true,
  required: ["idempotency-key"],
  properties: {
    "idempotency-key": {
      type: "string",
      minLength: 8,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
    },
  },
} as const;

export const paginationQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    cursor: { type: "string", minLength: 1, maxLength: 512 },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
  },
} as const;

export const pageMetadataSchema = {
  type: "object",
  additionalProperties: false,
  required: ["nextCursor", "limit"],
  properties: {
    nextCursor: { anyOf: [{ type: "string" }, { type: "null" }] },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  },
} as const;

export const sampleCommandRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: {
    message: { type: "string", minLength: 1, maxLength: 200 },
  },
} as const;

export const sampleCommandResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["message", "commandId", "transactionId", "executedAt"],
  properties: {
    message: { type: "string" },
    commandId: { type: "string", format: "uuid" },
    transactionId: { type: "string", format: "uuid" },
    executedAt: { type: "string", format: "date-time" },
  },
} as const;

const iataSchema = { type: "string", pattern: "^[A-Z]{3}$" } as const;
const localDateSchema = { type: "string", format: "date" } as const;
const localTimeSchema = { type: "string", pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$" } as const;

export const routeResearchQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["origin", "destination", "aircraftId"],
  properties: {
    origin: iataSchema,
    destination: iataSchema,
    aircraftId: { type: "string", format: "uuid" },
    at: { type: "string", format: "date-time" },
  },
} as const;

export const routeCreateRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["originIataCode", "destinationIataCode", "aircraftId"],
  properties: {
    originIataCode: iataSchema,
    destinationIataCode: iataSchema,
    aircraftId: { type: "string", format: "uuid" },
  },
} as const;

export const routeIdentifierParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["airlineId", "routeId"],
  properties: {
    airlineId: { type: "string", format: "uuid" },
    routeId: { type: "string", format: "uuid" },
  },
} as const;

export const timetableIdentifierParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["airlineId", "timetableVersionId"],
  properties: {
    airlineId: { type: "string", format: "uuid" },
    timetableVersionId: { type: "string", format: "uuid" },
  },
} as const;

export const timetableActivationRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["aircraftId", "effectiveFromLocalDate", "legs"],
  properties: {
    aircraftId: { type: "string", format: "uuid" },
    effectiveFromLocalDate: localDateSchema,
    horizonDays: { type: "integer", minimum: 7, maximum: 90 },
    legs: {
      type: "array",
      minItems: 1,
      maxItems: 28,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["dayOfWeek", "originIataCode", "destinationIataCode", "departureLocalTime"],
        properties: {
          dayOfWeek: { type: "integer", minimum: 0, maximum: 6 },
          originIataCode: iataSchema,
          destinationIataCode: iataSchema,
          departureLocalTime: localTimeSchema,
        },
      },
    },
  },
} as const;

export const horizonExtensionRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["through"],
  properties: { through: localDateSchema },
} as const;

const schedulingIssueSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "message", "suggestedCorrection"],
  properties: {
    code: { type: "string" },
    message: { type: "string" },
    field: { type: "string" },
    suggestedCorrection: { type: "string" },
  },
} as const;
const airportSchedulingSchema = {
  type: "object",
  additionalProperties: true,
  required: [
    "id",
    "iataCode",
    "countryCode",
    "timezoneName",
    "longestRunwayFt",
    "outsourcedServiceEligible",
    "hourlyMovementCeiling",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    iataCode: iataSchema,
    countryCode: { type: "string" },
    timezoneName: { type: "string" },
    longestRunwayFt: { type: "integer" },
    outsourcedServiceEligible: { type: "boolean" },
    hourlyMovementCeiling: { type: "integer" },
  },
} as const;
export const routeResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "airlineId",
    "marketId",
    "routeNumber",
    "origin",
    "destination",
    "distanceNm",
    "status",
    "rulesetVersion",
    "createdAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    airlineId: { type: "string", format: "uuid" },
    marketId: { type: "string", format: "uuid" },
    routeNumber: { type: "integer" },
    origin: airportSchedulingSchema,
    destination: airportSchedulingSchema,
    distanceNm: { type: "integer" },
    status: { type: "string", enum: ["researched", "active"] },
    rulesetVersion: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
  },
} as const;
export const routesResponseSchema = { type: "array", items: routeResponseSchema } as const;
const signedMinorSchema = { type: "string", pattern: "^-?[0-9]+$" } as const;
const routeForecastSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "distanceNm",
    "plannedBlockMinutes",
    "minimumTurnaroundMinutes",
    "provisionalOperatingCostMinor",
    "provisionalDailyDemand",
    "currency",
    "expectedDailyRevenueRangeMinor",
    "expectedDailyProfitRangeMinor",
    "economicsEffectiveAt",
    "economicsAssumptions",
    "operatingCostFormulaVersion",
    "economicsFormulaVersion",
    "blockTimeFormulaVersion",
    "outsourcedService",
  ],
  properties: {
    distanceNm: { type: "integer", minimum: 0 },
    plannedBlockMinutes: { type: "integer", minimum: 1 },
    minimumTurnaroundMinutes: { type: "integer", minimum: 1 },
    provisionalOperatingCostMinor: exactMinorSchema,
    provisionalDailyDemand: { type: "string" },
    currency: { type: "string" },
    expectedDailyRevenueRangeMinor: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: exactMinorSchema,
    },
    expectedDailyProfitRangeMinor: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: signedMinorSchema,
    },
    economicsEffectiveAt: { type: "string", format: "date-time" },
    economicsAssumptions: { type: "array", items: { type: "string" } },
    operatingCostFormulaVersion: { type: "string", const: "schedule-cost-v1" },
    economicsFormulaVersion: { type: "string", const: "schedule-economics-v1" },
    blockTimeFormulaVersion: { type: "string", const: "schedule-block-v1" },
    outsourcedService: { type: "boolean", const: true },
  },
} as const;
export const routeResearchSchedulingResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["market", "forecast", "valid", "issues", "explanations"],
  properties: {
    market: marketResearchResponseSchema,
    forecast: routeForecastSchema,
    valid: { type: "boolean" },
    issues: { type: "array", items: schedulingIssueSchema },
    explanations: { type: "array", items: { type: "string" } },
  },
} as const;
const datedFlightPlanningSchema = {
  type: "object",
  additionalProperties: true,
  required: [
    "id",
    "routeId",
    "timetableVersionId",
    "aircraftId",
    "flightNumber",
    "serviceDate",
    "originIataCode",
    "destinationIataCode",
    "departureLocal",
    "arrivalLocal",
    "departureAt",
    "arrivalAt",
    "readyAt",
    "status",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    routeId: { type: "string", format: "uuid" },
    timetableVersionId: { type: "string", format: "uuid" },
    aircraftId: { type: "string", format: "uuid" },
    flightNumber: { type: "string" },
    serviceDate: localDateSchema,
    originIataCode: iataSchema,
    destinationIataCode: iataSchema,
    departureLocal: { type: "string" },
    arrivalLocal: { type: "string" },
    departureAt: { type: "string", format: "date-time" },
    arrivalAt: { type: "string", format: "date-time" },
    readyAt: { type: "string", format: "date-time" },
    status: { type: "string" },
  },
} as const;
export const routePlanningResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["route", "forecast"],
  properties: {
    route: routeResponseSchema,
    forecast: routeForecastSchema,
    timetable: {
      type: "object",
      additionalProperties: false,
      required: [
        "timetableVersionId",
        "version",
        "effectiveFrom",
        "generatedThrough",
        "aircraftId",
        "legs",
        "flights",
      ],
      properties: {
        timetableVersionId: { type: "string", format: "uuid" },
        version: { type: "integer", minimum: 1 },
        effectiveFrom: localDateSchema,
        generatedThrough: localDateSchema,
        aircraftId: { type: "string", format: "uuid" },
        legs: timetableActivationRequestSchema.properties.legs,
        flights: { type: "array", items: datedFlightPlanningSchema },
      },
    },
  },
} as const;
export const timetableActivationResponseSchema = {
  type: "object",
  additionalProperties: true,
  required: [
    "route",
    "timetableVersionId",
    "version",
    "effectiveFrom",
    "generatedThrough",
    "aircraftId",
    "flights",
    "validation",
  ],
  properties: {
    route: routeResponseSchema,
    timetableVersionId: { type: "string", format: "uuid" },
    version: { type: "integer" },
    effectiveFrom: localDateSchema,
    generatedThrough: localDateSchema,
    aircraftId: { type: "string", format: "uuid" },
    flights: { type: "array", items: datedFlightPlanningSchema },
    validation: { type: "object", additionalProperties: true },
  },
} as const;

export const weatherRouteParamsSchema = routeIdentifierParamsSchema;
export const weatherDepartureParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["airlineId", "datedFlightId"],
  properties: {
    airlineId: { type: "string", format: "uuid" },
    datedFlightId: { type: "string", format: "uuid" },
  },
} as const;
export const weatherForecastQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["validAt"],
  properties: { validAt: { type: "string", format: "date-time" } },
} as const;
export const weatherForecastResponseSchema = {
  type: "object",
  additionalProperties: true,
  required: ["id", "scope", "scopeId", "issuedAt", "validAt", "plan", "materialInputSnapshot"],
  properties: {
    id: { type: "string", format: "uuid" },
    scope: { type: "string", enum: ["route", "departure"] },
    scopeId: { type: "string", format: "uuid" },
    issuedAt: { type: "string", format: "date-time" },
    validAt: { type: "string", format: "date-time" },
    plan: { type: "object", additionalProperties: true },
    materialInputSnapshot: { type: "object", additionalProperties: true },
  },
} as const;

const workforceRoleSchema = {
  type: "string",
  enum: ["pilot", "cabin_crew", "line_maintenance", "ground_handling"],
} as const;
export const workforceHireRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["role", "capacity"],
  properties: {
    role: workforceRoleSchema,
    capacity: { type: "integer", minimum: 1, maximum: 1000 },
    qualificationAircraftVariantId: { type: "string", format: "uuid" },
  },
} as const;
export const workforceForecastRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["through"],
  properties: { through: { type: "string", format: "date-time" } },
} as const;
export const workforceWageAccrualRequestSchema = workforceForecastRequestSchema;
export const workforceFlightParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["airlineId", "flightId"],
  properties: {
    airlineId: { type: "string", format: "uuid" },
    flightId: { type: "string", format: "uuid" },
  },
} as const;
const workforceQualificationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code"],
  properties: {
    code: { type: "string" },
    aircraftVariantId: { type: "string", format: "uuid" },
    catalogReleaseId: { type: "string", format: "uuid" },
  },
} as const;
const workforcePoolSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "airlineId",
    "baseAirportId",
    "baseIataCode",
    "role",
    "qualification",
    "activeCapacity",
    "pendingCapacity",
    "wagePerIntervalMinor",
    "reportingCurrency",
    "wageCheckpointAt",
    "nextWageDueAt",
    "version",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    airlineId: { type: "string", format: "uuid" },
    baseAirportId: { type: "string", format: "uuid" },
    baseIataCode: iataSchema,
    role: workforceRoleSchema,
    qualification: workforceQualificationSchema,
    activeCapacity: { type: "integer", minimum: 0 },
    pendingCapacity: { type: "integer", minimum: 0 },
    nextAvailableAt: dateTimeSchema,
    wagePerIntervalMinor: exactMinorSchema,
    reportingCurrency: foundingSelectionProperties.reportingCurrency,
    wageCheckpointAt: dateTimeSchema,
    nextWageDueAt: dateTimeSchema,
    version: exactMinorSchema,
  },
} as const;
export const workforcePoolsResponseSchema = {
  type: "array",
  items: workforcePoolSchema,
} as const;
export const workforceRecommendationsResponseSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["variantId", "variantCode", "rulesetVersion", "minimumCapacity", "explanation"],
    properties: {
      variantId: { type: "string", format: "uuid" },
      variantCode: { type: "string" },
      rulesetVersion: { type: "string" },
      minimumCapacity: {
        type: "object",
        additionalProperties: false,
        required: ["pilot", "cabin_crew", "line_maintenance", "ground_handling"],
        properties: {
          pilot: { type: "integer", minimum: 0 },
          cabin_crew: { type: "integer", minimum: 0 },
          line_maintenance: { type: "integer", minimum: 0 },
          ground_handling: { type: "integer", minimum: 0 },
        },
      },
      explanation: { type: "string" },
    },
  },
} as const;
export const workforceHireResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "pool",
    "capacity",
    "hiredAt",
    "availableAt",
    "status",
    "hiringCostMinor",
    "trainingCostMinor",
    "hiringJournalEntryId",
    "trainingJournalEntryId",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    pool: workforcePoolSchema,
    capacity: { type: "integer", minimum: 1 },
    hiredAt: dateTimeSchema,
    availableAt: dateTimeSchema,
    status: { type: "string", enum: ["training", "available"] },
    hiringCostMinor: exactMinorSchema,
    trainingCostMinor: exactMinorSchema,
    hiringJournalEntryId: { type: "string", format: "uuid" },
    trainingJournalEntryId: { type: "string", format: "uuid" },
  },
} as const;
const workforceShortageSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "flightId",
    "flightNumber",
    "role",
    "qualificationCode",
    "baseAirportId",
    "baseIataCode",
    "windowStartsAt",
    "windowEndsAt",
    "requiredCapacity",
    "availableCapacity",
    "shortfall",
    "correction",
  ],
  properties: {
    flightId: { type: "string", format: "uuid" },
    flightNumber: { type: "string" },
    role: workforceRoleSchema,
    qualificationCode: { type: "string" },
    baseAirportId: { type: "string", format: "uuid" },
    baseIataCode: iataSchema,
    windowStartsAt: dateTimeSchema,
    windowEndsAt: dateTimeSchema,
    requiredCapacity: { type: "integer", minimum: 0 },
    availableCapacity: { type: "integer", minimum: 0 },
    shortfall: { type: "integer", minimum: 0 },
    correction: { type: "string" },
  },
} as const;
export const workforceForecastResponseSchema = {
  type: "object",
  additionalProperties: true,
  required: ["generatedAt", "through", "feasible", "shortages", "explanations"],
  properties: {
    generatedAt: { type: "string", format: "date-time" },
    through: { type: "string", format: "date-time" },
    feasible: { type: "boolean" },
    shortages: { type: "array", items: workforceShortageSchema },
    explanations: { type: "array", items: { type: "string" } },
  },
} as const;
export const workforceReadinessResponseSchema = {
  type: "object",
  additionalProperties: true,
  required: ["flightId", "ready", "allocations", "shortages", "formulaVersions"],
  properties: {
    flightId: { type: "string", format: "uuid" },
    ready: { type: "boolean" },
    allocations: { type: "array", items: { type: "object", additionalProperties: true } },
    shortages: { type: "array", items: { type: "object", additionalProperties: true } },
    formulaVersions: { type: "object", additionalProperties: true },
  },
} as const;
export const workforceWageAccrualResponseSchema = workforcePoolsResponseSchema;

export const maintenanceAircraftParamsSchema = aircraftIdentifierParamsSchema;
export const maintenanceWorkPackageParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["airlineId", "workPackageId"],
  properties: {
    airlineId: { type: "string", format: "uuid" },
    workPackageId: { type: "string", format: "uuid" },
  },
} as const;
export const maintenanceFlightCompletionRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["completionKey", "completedAt", "blockMinutes", "cycles", "faultSeed"],
  properties: {
    completionKey: { type: "string", minLength: 1, maxLength: 200 },
    completedAt: { type: "string", format: "date-time" },
    blockMinutes: { type: "integer", minimum: 1, maximum: 1440 },
    cycles: { type: "integer", minimum: 1, maximum: 10 },
    faultSeed: { type: "string", minLength: 1, maxLength: 200 },
  },
} as const;
export const maintenanceWindowRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["startsAt"],
  properties: {
    ruleCode: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]+$" },
    faultId: { type: "string", format: "uuid" },
    startsAt: { type: "string", format: "date-time" },
  },
} as const;
export const maintenanceReadinessRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["at"],
  properties: { at: { type: "string", format: "date-time" } },
} as const;
export const maintenanceProgramResponseSchema = {
  type: "object",
  additionalProperties: true,
  required: ["id", "version", "aircraftVariantId", "aircraftVariantCode", "rules"],
  properties: {
    id: { type: "string", format: "uuid" },
    version: { type: "string" },
    aircraftVariantId: { type: "string", format: "uuid" },
    aircraftVariantCode: { type: "string" },
    utilizationFormulaVersion: { type: "string" },
    conditionFormulaVersion: { type: "string" },
    faultFormulaVersion: { type: "string" },
    calendarSemantics: { type: "string", const: "elapsed_utc_days" },
    rules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "code",
          "name",
          "kind",
          "hardLimit",
          "maximumDeferralHoursMinutes",
          "maximumDeferralCycles",
          "maximumDeferralCalendarDays",
          "durationMinutes",
          "workforceCapacity",
          "costMinor",
          "conditionRestoreBasisPoints",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          code: { type: "string" },
          name: { type: "string" },
          kind: { type: "string", enum: ["line", "package"] },
          intervalHoursMinutes: exactMinorSchema,
          intervalCycles: exactMinorSchema,
          intervalCalendarDays: { type: "integer", minimum: 0 },
          hardLimit: { type: "boolean" },
          maximumDeferralHoursMinutes: exactMinorSchema,
          maximumDeferralCycles: exactMinorSchema,
          maximumDeferralCalendarDays: { type: "integer", minimum: 0 },
          durationMinutes: { type: "integer", minimum: 1 },
          workforceCapacity: { type: "integer", minimum: 1 },
          costMinor: exactMinorSchema,
          conditionRestoreBasisPoints: basisPointsSchema,
        },
      },
    },
  },
} as const;
export const maintenanceFlightCompletionResponseSchema = {
  type: "object",
  additionalProperties: true,
  required: [
    "completionKey",
    "aircraftId",
    "accumulatedHoursMinutes",
    "accumulatedCycles",
    "fault",
    "processedAt",
  ],
  properties: {
    completionKey: { type: "string" },
    aircraftId: { type: "string", format: "uuid" },
    accumulatedHoursMinutes: exactMinorSchema,
    accumulatedCycles: exactMinorSchema,
    fault: { type: "object", additionalProperties: true },
    processedAt: { type: "string", format: "date-time" },
  },
} as const;
export const maintenanceWorkPackageResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "aircraftId",
    "source",
    "status",
    "startsAt",
    "endsAt",
    "airportId",
    "workforceCapacity",
    "costMinor",
    "programVersion",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    aircraftId: { type: "string", format: "uuid" },
    source: { type: "string", enum: ["planned", "repair"] },
    status: { type: "string", enum: ["planned", "completed"] },
    startsAt: { type: "string", format: "date-time" },
    endsAt: { type: "string", format: "date-time" },
    airportId: { type: "string", format: "uuid" },
    workforceCapacity: { type: "integer", minimum: 1 },
    costMinor: exactMinorSchema,
    ruleCode: { type: "string" },
    faultId: { type: "string", format: "uuid" },
    programVersion: { type: "string" },
    journalEntryId: { type: "string", format: "uuid" },
  },
} as const;
export const maintenanceForecastResponseSchema = {
  type: "object",
  additionalProperties: true,
  required: [
    "aircraftId",
    "generatedAt",
    "programVersion",
    "dispatchReady",
    "conditionBasisPoints",
    "dispatchReliabilityBasisPoints",
    "due",
    "plannedWork",
    "activeFaults",
    "scheduleConflicts",
    "workforceNeeds",
    "explanations",
    "recoverySteps",
  ],
  properties: {
    aircraftId: { type: "string", format: "uuid" },
    generatedAt: { type: "string", format: "date-time" },
    programVersion: { type: "string" },
    dispatchReady: { type: "boolean" },
    conditionBasisPoints: basisPointsSchema,
    dispatchReliabilityBasisPoints: basisPointsSchema,
    due: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ruleCode", "state", "hardLimitExceeded", "explanation", "recoveryStep"],
        properties: {
          ruleCode: { type: "string" },
          state: { type: "string", enum: ["not_due", "due", "soft_overdue", "hard_overdue"] },
          hoursMinutesRemaining: exactMinorSchema,
          cyclesRemaining: exactMinorSchema,
          calendarDaysRemaining: { type: "integer" },
          hardLimitExceeded: { type: "boolean" },
          explanation: { type: "string" },
          recoveryStep: { type: "string" },
        },
      },
    },
    plannedWork: { type: "array", items: maintenanceWorkPackageResponseSchema },
    activeFaults: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "outcome",
          "groundsAircraft",
          "repairDurationMinutes",
          "repairWorkforceCapacity",
          "explanation",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          outcome: { type: "string", enum: ["delay", "grounding"] },
          groundsAircraft: { type: "boolean" },
          repairDurationMinutes: { type: "integer", minimum: 0 },
          repairWorkforceCapacity: { type: "integer", minimum: 0 },
          explanation: { type: "string" },
        },
      },
    },
    scheduleConflicts: { type: "array", items: { type: "string" } },
    workforceNeeds: { type: "array", items: { type: "string" } },
    explanations: { type: "array", items: { type: "string" } },
    recoverySteps: { type: "array", items: { type: "string" } },
  },
} as const;
export const maintenanceHistoryResponseSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["id", "aircraftId", "sequence", "eventType", "occurredAt", "details"],
    properties: {
      id: { type: "string", format: "uuid" },
      aircraftId: { type: "string", format: "uuid" },
      sequence: exactMinorSchema,
      eventType: { type: "string" },
      occurredAt: dateTimeSchema,
      details: { type: "object", additionalProperties: true },
      journalEntryId: { type: "string", format: "uuid" },
    },
  },
} as const;

export const flightOperationsParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["airlineId", "flightId"],
  properties: {
    airlineId: { type: "string", format: "uuid" },
    flightId: { type: "string", format: "uuid" },
  },
} as const;
export const flightStatusResponseSchema = {
  type: "object",
  additionalProperties: true,
  required: [
    "id",
    "airlineId",
    "flightNumber",
    "state",
    "version",
    "departureAt",
    "scheduledArrivalAt",
    "effectiveAt",
    "timeline",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    airlineId: { type: "string", format: "uuid" },
    flightNumber: { type: "string" },
    state: {
      type: "string",
      enum: [
        "scheduled",
        "suspended",
        "cancelled",
        "delayed",
        "boarding",
        "departed",
        "diverted",
        "arrived",
        "settled",
      ],
    },
    version: exactMinorSchema,
    departureAt: { type: "string", format: "date-time" },
    scheduledArrivalAt: { type: "string", format: "date-time" },
    effectiveAt: { type: "string", format: "date-time" },
    timeline: { type: "array", items: { type: "object", additionalProperties: true } },
    suspension: { type: "object", additionalProperties: true },
  },
} as const;
export const flightSettlementResponseSchema = {
  type: "object",
  additionalProperties: true,
  required: [
    "id",
    "flightId",
    "schemaVersion",
    "settledAt",
    "materialInputs",
    "outcome",
    "journalEntryIds",
    "reconciliation",
    "contentHash",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    flightId: { type: "string", format: "uuid" },
    schemaVersion: { type: "integer", const: 1 },
    settledAt: { type: "string", format: "date-time" },
    materialInputs: { type: "object", additionalProperties: true },
    outcome: { type: "object", additionalProperties: true },
    journalEntryIds: { type: "array", items: { type: "string", format: "uuid" } },
    reconciliation: { type: "object", additionalProperties: { type: "string" } },
    contentHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
  },
} as const;

export type NotificationPreferencesRequest = Readonly<{
  browserEnabled: boolean;
  minimumBrowserSeverity: "info" | "warning" | "critical";
  quietHours: Readonly<{ start: string; end: string; timeZone: string }> | null;
}>;
export type NotificationReadRequest = Readonly<{ read: boolean }>;
const notificationSeveritySchema = {
  type: "string",
  enum: ["info", "warning", "critical"],
} as const;
const quietHoursSchema = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      required: ["start", "end", "timeZone"],
      properties: {
        start: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
        end: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
        timeZone: { type: "string", minLength: 1, maxLength: 100 },
      },
    },
  ],
} as const;
export const notificationPreferencesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["browserEnabled", "minimumBrowserSeverity", "quietHours"],
  properties: {
    browserEnabled: { type: "boolean" },
    minimumBrowserSeverity: notificationSeveritySchema,
    quietHours: quietHoursSchema,
  },
} as const;
export const notificationReadRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["read"],
  properties: { read: { type: "boolean" } },
} as const;
export const playerNotificationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "eventId",
    "eventType",
    "severity",
    "title",
    "body",
    "resourceType",
    "resourceId",
    "recoveryAction",
    "occurredAt",
    "createdAt",
    "readAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    eventId: exactMinorSchema,
    eventType: { type: "string" },
    severity: notificationSeveritySchema,
    title: { type: "string" },
    body: { type: "string" },
    resourceType: { type: "string" },
    resourceId: { type: "string", format: "uuid" },
    recoveryAction: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["label", "resourceType", "resourceId", "path"],
          properties: {
            label: { type: "string" },
            resourceType: { type: "string" },
            resourceId: { type: "string", format: "uuid" },
            path: { type: "string" },
          },
        },
      ],
    },
    occurredAt: { type: "string", format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    readAt: { anyOf: [{ type: "null" }, { type: "string", format: "date-time" }] },
  },
} as const;
export const notificationListResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items", "nextCursor"],
  properties: {
    items: { type: "array", items: playerNotificationSchema },
    nextCursor: { anyOf: [{ type: "null" }, exactMinorSchema] },
  },
} as const;

export function createHealthResponse(service: HealthResponse["service"]): HealthResponse {
  return { service, status: "ok" };
}

export function createReadinessResponse(
  service: HealthResponse["service"],
  dependencies: Readonly<{ postgres: boolean; redis: boolean }>,
): ReadinessResponse {
  return {
    service,
    status: dependencies.postgres && dependencies.redis ? "ready" : "not_ready",
    dependencies: {
      postgres: dependencies.postgres ? "up" : "down",
      redis: dependencies.redis ? "up" : "down",
    },
  };
}

export * from "./generated/index.js";
export * from "./api-client.js";
