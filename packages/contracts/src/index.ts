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

export type ErrorDetail = Readonly<{ field?: string; issue: string }>;

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
