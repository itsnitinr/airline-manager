export type Clock = Readonly<{
  now: () => Date;
}>;

export function readCurrentTime(clock: Clock): Date {
  return clock.now();
}

/** Domain-facing persistence contract. Adapter and row types must never appear here. */
export interface Repository<TEntity, TIdentifier> {
  findById(identifier: TIdentifier): Promise<TEntity | undefined>;
  save(entity: TEntity): Promise<TEntity>;
}

/** Persisted aggregates use positive, monotonically increasing optimistic versions. */
export interface VersionedEntity {
  readonly version: number;
}

export {
  aircraftVariantPlayableFields,
  airportPlayableFields,
  type AcquisitionChannel,
  type AircraftCategory,
  type CatalogAircraftVariant,
  type CatalogAirport,
  type CatalogRepository,
  type FieldProvenance,
  type ProvenanceClassification,
  type PublishedCatalog,
} from "./catalog.js";
export {
  playerRoles,
  type IdentityRepository,
  type OwnedResource,
  type PlayerAccount,
  type PlayerRole,
} from "./identity.js";
export * from "./finance.js";
export * from "./fleet.js";
export * from "./airline.js";
export * from "./fuel.js";
export * from "./market.js";
