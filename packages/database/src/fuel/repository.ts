import { createHash, randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import {
  FuelDomainError,
  forecastFuel,
  generateFuelPrice,
  priceFuelQuantity,
  weightedConsumptionCost,
  type CurrencyCode,
  type FuelCapacityOffer,
  type FuelCapacityUpgrade,
  type FuelForecast,
  type FuelInventory,
  type FuelLot,
  type FuelMovement,
  type FuelPrice,
  type FuelPurchase,
  type FuelQuote,
  type FuelRepository,
} from "@airline-manager/domain";
import type { Database } from "../database.js";
import type { DB } from "../generated/database.js";
import { KyselyLedgerRepository } from "../finance/repository.js";
import { runInTransaction } from "../transactions.js";

type Queryable = Database | Transaction<DB>;

type ContextRow = Readonly<{
  airline_id: string;
  currency: CurrencyCode;
  ruleset_version: string;
  fuel_rules_id: string;
  fuel_rules_version: string;
  formula_version: string;
  bucket_minutes: number;
  quote_ttl_seconds: number;
  world_seed: string;
  base_prices: unknown;
  volatility_basis_points: number;
  capacity_tier_id: string;
  capacity_tier: number;
  capacity_kg: string;
  on_hand_kg: string;
  planning_reserved_kg: string;
  inventory_value_minor: string;
  minimum_reserve_kg: string;
  version: string;
}>;

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function exactMapValue(map: unknown, currency: CurrencyCode, label: string): bigint {
  if (typeof map !== "object" || map === null || Array.isArray(map))
    throw new Error(`${label} map is invalid.`);
  const value = (map as Record<string, unknown>)[currency];
  if (typeof value !== "string" || !/^[0-9]+$/.test(value))
    throw new Error(`${label} is unavailable for ${currency}.`);
  return BigInt(value);
}

async function contextRow(
  database: Queryable,
  playerAccountId: string | undefined,
  airlineId: string,
  lock = false,
): Promise<ContextRow> {
  const result = await sql<ContextRow>`SELECT a.id AS airline_id, a.reporting_currency AS currency,
    wr.version AS ruleset_version, fr.id AS fuel_rules_id, fr.version AS fuel_rules_version,
    fr.price_formula_version AS formula_version, fr.time_bucket_minutes AS bucket_minutes,
    fr.quote_ttl_seconds, fr.world_seed, fr.base_price_per_tonne_minor AS base_prices,
    fr.volatility_basis_points, i.capacity_tier_id, t.tier AS capacity_tier,
    t.capacity_kg::text, i.on_hand_kg::text, i.planning_reserved_kg::text,
    i.inventory_value_minor::text, i.minimum_reserve_kg::text, i.version::text
    FROM airlines a JOIN careers c ON c.id = a.career_id
    JOIN world_rulesets wr ON wr.id = c.world_ruleset_id
    JOIN fuel_ruleset_versions fr ON fr.world_ruleset_id = wr.id AND fr.status = 'active'
    JOIN airline_fuel_inventories i ON i.airline_id = a.id AND i.fuel_ruleset_version_id = fr.id
    JOIN fuel_capacity_tiers t ON t.id = i.capacity_tier_id
    ${
      playerAccountId
        ? sql`JOIN resource_ownerships own ON own.resource_type = 'airline'
      AND own.resource_id = a.id AND own.player_account_id = ${playerAccountId}::uuid`
        : sql``
    }
    WHERE a.id = ${airlineId}::uuid ${lock ? sql`FOR UPDATE OF a, i` : sql``}`.execute(database);
  const row = result.rows[0];
  if (!row) throw new FuelDomainError("fuel_not_found", "Fuel inventory is unavailable.");
  return row;
}

function priceFromContext(row: ContextRow, at: Date): FuelPrice {
  return generateFuelPrice(
    {
      worldSeed: row.world_seed,
      rulesetVersion: row.ruleset_version,
      fuelRulesVersion: row.fuel_rules_version,
      priceFormulaVersion: row.formula_version,
      bucketMinutes: row.bucket_minutes,
      volatilityBasisPoints: row.volatility_basis_points,
      basePricePerTonneMinor: exactMapValue(row.base_prices, row.currency, "Fuel base price"),
      currency: row.currency,
    },
    at,
  );
}

function inventoryFromContext(row: ContextRow): FuelInventory {
  const onHand = BigInt(row.on_hand_kg);
  const reserved = BigInt(row.planning_reserved_kg);
  const minimum = BigInt(row.minimum_reserve_kg);
  const protectedKg = reserved > minimum ? reserved : minimum;
  const available = onHand > protectedKg ? onHand - protectedKg : 0n;
  const capacity = BigInt(row.capacity_kg);
  const value = BigInt(row.inventory_value_minor);
  return {
    airlineId: row.airline_id,
    unit: "kg",
    onHandKg: onHand.toString(),
    planningReservedKg: reserved.toString(),
    minimumReserveKg: minimum.toString(),
    protectedKg: protectedKg.toString(),
    availableKg: available.toString(),
    capacityKg: capacity.toString(),
    capacityTier: row.capacity_tier,
    utilizationBasisPoints: ((onHand * 10_000n) / capacity).toString(),
    inventoryValueMinor: value.toString(),
    currency: row.currency,
    weightedUnitCostNumerator: value.toString(),
    weightedUnitCostDenominator: onHand === 0n ? "1" : onHand.toString(),
    version: row.version,
  };
}

type Book = Readonly<{ id: string; period_id: string }>;
async function ledgerBook(database: Queryable, airlineId: string, now: Date): Promise<Book> {
  const result = await sql<Book>`SELECT b.id,
    (SELECT p.id FROM accounting_periods p WHERE p.ledger_book_id = b.id AND p.status = 'open'
      AND ${now.toISOString()}::timestamptz::date BETWEEN p.starts_on AND p.ends_on LIMIT 1) AS period_id
    FROM ledger_books b WHERE b.owner_type = 'airline' AND b.owner_id = ${airlineId}::uuid FOR UPDATE`.execute(
    database,
  );
  const row = result.rows[0];
  if (!row?.period_id) throw new Error("Airline ledger or accounting period is unavailable.");
  return row;
}

async function cashBalance(database: Queryable, airlineId: string): Promise<bigint> {
  const result = await sql<{ balance: string }>`SELECT COALESCE(sum(CASE p.side WHEN 'debit'
    THEN p.reporting_amount_minor ELSE -p.reporting_amount_minor END), 0)::text AS balance
    FROM ledger_postings p JOIN ledger_accounts a ON a.id = p.account_id
    JOIN journal_entries j ON j.id = p.journal_entry_id AND j.status = 'posted'
    WHERE a.code = '1000' AND p.airline_id = ${airlineId}::uuid`.execute(database);
  return BigInt(result.rows[0]?.balance ?? "0");
}

async function beginIdempotency(
  database: Queryable,
  scope: string,
  key: string,
  type: string,
  hash: string,
): Promise<unknown | undefined> {
  const inserted = await sql<{ inserted: boolean }>`INSERT INTO idempotency_commands
    (scope, idempotency_key, command_type, request_hash, expires_at)
    VALUES (${scope}, ${key}, ${type}, ${hash}, CURRENT_TIMESTAMP + INTERVAL '30 days')
    ON CONFLICT (scope, idempotency_key) DO NOTHING RETURNING true AS inserted`.execute(database);
  const existing = await sql<{
    request_hash: string;
    state: string;
    response_body: unknown;
  }>`SELECT request_hash, state, response_body
    FROM idempotency_commands WHERE scope = ${scope} AND idempotency_key = ${key} FOR UPDATE`.execute(
    database,
  );
  const row = existing.rows[0];
  if (!row) throw new Error("Fuel idempotency record was not persisted.");
  if (row.request_hash.trim() !== hash)
    throw new FuelDomainError(
      "idempotency_conflict",
      "Idempotency key was reused with a different fuel command.",
    );
  return inserted.rows.length === 0 && row.state === "completed" ? row.response_body : undefined;
}

async function completeIdempotency(
  database: Queryable,
  scope: string,
  key: string,
  response: unknown,
): Promise<void> {
  await sql`UPDATE idempotency_commands SET state = 'completed', response_status = 200,
    response_body = ${JSON.stringify(response)}::jsonb, updated_at = CURRENT_TIMESTAMP
    WHERE scope = ${scope} AND idempotency_key = ${key}`.execute(database);
}

function quoteFromRow(row: Readonly<Record<string, unknown>>): FuelQuote {
  return {
    id: String(row.id),
    airlineId: String(row.airline_id),
    quantityKg: String(row.quantity_kg),
    currency: row.currency as CurrencyCode,
    unitPriceNumerator: String(row.unit_price_numerator),
    unitPriceDenominator: String(row.unit_price_denominator),
    totalPriceMinor: String(row.total_price_minor),
    rulesetVersion: String(row.fuel_rules_version),
    priceFormulaVersion: String(row.price_formula_version),
    bucketStart: (row.time_bucket_start as Date).toISOString(),
    createdAt: (row.created_at as Date).toISOString(),
    expiresAt: (row.expires_at as Date).toISOString(),
  };
}

export class KyselyFuelRepository implements FuelRepository {
  public constructor(private readonly database: Database) {}

  public async currentPrices(
    playerAccountId: string,
    airlineId: string,
    now: Date,
    recentBuckets: number,
  ): Promise<readonly FuelPrice[]> {
    const row = await contextRow(this.database, playerAccountId, airlineId);
    const count = Math.max(1, Math.min(48, recentBuckets));
    return Array.from({ length: count }, (_, index) =>
      priceFromContext(row, new Date(now.getTime() - index * row.bucket_minutes * 60_000)),
    );
  }

  public async createQuote(
    playerAccountId: string,
    airlineId: string,
    quantityKg: bigint,
    now: Date,
  ): Promise<FuelQuote> {
    if (quantityKg <= 0n)
      throw new FuelDomainError(
        "invalid_fuel_quantity",
        "Fuel quantity must be positive whole kilograms.",
      );
    const row = await contextRow(this.database, playerAccountId, airlineId);
    const price = priceFromContext(row, now);
    const total = priceFuelQuantity(
      quantityKg,
      BigInt(price.unitPriceNumerator),
      BigInt(price.unitPriceDenominator),
    );
    const expires = new Date(now.getTime() + row.quote_ttl_seconds * 1_000);
    const inserted = await sql<Record<string, unknown>>`INSERT INTO fuel_purchase_quotes
      (airline_id, fuel_ruleset_version_id, price_formula_version, time_bucket_start,
       quantity_kg, currency, unit_price_numerator, unit_price_denominator, total_price_minor,
       exchange_rate_numerator, exchange_rate_denominator, created_at, expires_at)
      VALUES (${airlineId}::uuid, ${row.fuel_rules_id}::uuid, ${price.priceFormulaVersion},
        ${price.bucketStart}::timestamptz, ${quantityKg.toString()}::bigint, ${row.currency},
        ${price.unitPriceNumerator}::bigint, ${price.unitPriceDenominator}::bigint,
        ${total.toString()}::bigint, 1, 1, ${now.toISOString()}::timestamptz,
        ${expires.toISOString()}::timestamptz)
      RETURNING id, airline_id, quantity_kg::text, currency, unit_price_numerator::text,
        unit_price_denominator::text, total_price_minor::text, price_formula_version,
        time_bucket_start, created_at, expires_at, ${row.fuel_rules_version}::text AS fuel_rules_version`.execute(
      this.database,
    );
    const quote = inserted.rows[0];
    if (!quote) throw new Error("Fuel quote was not created.");
    return quoteFromRow(quote);
  }

  public purchase(
    playerAccountId: string,
    airlineId: string,
    quoteId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<FuelPurchase> {
    const scope = `fuel-purchase:${airlineId}`;
    const hash = requestHash({ airlineId, quoteId });
    return runInTransaction(
      this.database,
      async (transaction) => {
        const existing = await beginIdempotency(
          transaction,
          scope,
          idempotencyKey,
          "fuel_purchase",
          hash,
        );
        if (existing) return existing as FuelPurchase;
        const context = await contextRow(transaction, playerAccountId, airlineId, true);
        const quotes = await sql<
          Record<string, unknown>
        >`SELECT q.id, q.airline_id, q.quantity_kg::text,
        q.currency, q.unit_price_numerator::text, q.unit_price_denominator::text,
        q.total_price_minor::text, q.price_formula_version, q.time_bucket_start, q.created_at,
        q.expires_at, q.accepted_at, fr.version AS fuel_rules_version
        FROM fuel_purchase_quotes q JOIN fuel_ruleset_versions fr ON fr.id = q.fuel_ruleset_version_id
        WHERE q.id = ${quoteId}::uuid FOR UPDATE OF q`.execute(transaction);
        const quoteRow = quotes.rows[0];
        if (!quoteRow)
          throw new FuelDomainError("fuel_quote_not_found", "Fuel quote is unavailable.");
        if (String(quoteRow.airline_id) !== airlineId)
          throw new FuelDomainError(
            "fuel_quote_wrong_airline",
            "Fuel quote does not belong to this airline.",
          );
        if (quoteRow.accepted_at)
          throw new FuelDomainError(
            "fuel_quote_already_accepted",
            "Fuel quote has already been accepted by another command.",
          );
        if (now > (quoteRow.expires_at as Date))
          throw new FuelDomainError(
            "fuel_quote_expired",
            "Fuel quote has expired; request a new quote.",
          );
        const quantity = BigInt(String(quoteRow.quantity_kg));
        const total = BigInt(String(quoteRow.total_price_minor));
        if (BigInt(context.on_hand_kg) + quantity > BigInt(context.capacity_kg))
          throw new FuelDomainError(
            "fuel_capacity_exceeded",
            "Purchase would exceed global fuel storage capacity.",
          );
        const book = await ledgerBook(transaction, airlineId, now);
        if ((await cashBalance(transaction, airlineId)) < total)
          throw new FuelDomainError(
            "insufficient_cash",
            "Airline cash is insufficient for this fuel purchase.",
          );
        const journal = await new KyselyLedgerRepository(transaction, true).post({
          ledgerBookId: book.id,
          accountingPeriodId: book.period_id,
          idempotencyKey: `${idempotencyKey}:ledger`,
          commandType: "fuel",
          cashFlowActivity: "operating",
          description: "Global fuel purchase",
          occurredAt: now,
          transactionCurrency: context.currency,
          reportingCurrency: context.currency,
          postings: [
            {
              accountCode: "1200",
              side: "debit",
              transactionAmountMinor: total,
              reportingAmountMinor: total,
              dimensions: { airlineId },
            },
            {
              accountCode: "1000",
              side: "credit",
              transactionAmountMinor: total,
              reportingAmountMinor: total,
              dimensions: { airlineId },
            },
          ],
        });
        const lotId = randomUUID();
        await sql`INSERT INTO fuel_purchase_lots
        (id, airline_id, quote_id, quantity_kg, cost_basis_minor, currency,
         unit_price_numerator, unit_price_denominator, price_formula_version, fuel_ruleset_version,
         exchange_rate_numerator, exchange_rate_denominator, purchased_at, provenance,
         ledger_journal_entry_id, source_idempotency_key)
        VALUES (${lotId}::uuid, ${airlineId}::uuid, ${quoteId}::uuid, ${quantity.toString()}::bigint,
          ${total.toString()}::bigint, ${context.currency}, ${String(quoteRow.unit_price_numerator)}::bigint,
          ${String(quoteRow.unit_price_denominator)}::bigint, ${String(quoteRow.price_formula_version)},
          ${String(quoteRow.fuel_rules_version)}, 1, 1, ${now.toISOString()}::timestamptz,
          ${JSON.stringify({ source: "deterministic-offline-global-market", bucketStart: (quoteRow.time_bucket_start as Date).toISOString() })}::jsonb,
          ${journal.journalEntryId}::uuid, ${idempotencyKey})`.execute(transaction);
        const nextQuantity = BigInt(context.on_hand_kg) + quantity;
        const nextValue = BigInt(context.inventory_value_minor) + total;
        const movementId = randomUUID();
        await sql`UPDATE airline_fuel_inventories SET on_hand_kg = ${nextQuantity.toString()}::bigint,
        inventory_value_minor = ${nextValue.toString()}::bigint, version = version + 1,
        updated_at = ${now.toISOString()}::timestamptz WHERE airline_id = ${airlineId}::uuid`.execute(
          transaction,
        );
        await sql`INSERT INTO fuel_inventory_movements
        (id, airline_id, movement_type, quantity_delta_kg, inventory_value_delta_minor,
         balance_after_kg, reserved_after_kg, inventory_value_after_minor, source_type,
         source_id, source_idempotency_key, purchase_lot_id, ledger_journal_entry_id, occurred_at)
        VALUES (${movementId}::uuid, ${airlineId}::uuid, 'purchase', ${quantity.toString()}::bigint,
          ${total.toString()}::bigint, ${nextQuantity.toString()}::bigint,
          ${context.planning_reserved_kg}::bigint, ${nextValue.toString()}::bigint,
          'fuel_quote', ${quoteId}, ${idempotencyKey}, ${lotId}::uuid,
          ${journal.journalEntryId}::uuid, ${now.toISOString()}::timestamptz)`.execute(transaction);
        await sql`UPDATE fuel_purchase_quotes SET accepted_at = ${now.toISOString()}::timestamptz WHERE id = ${quoteId}::uuid`.execute(
          transaction,
        );
        await sql`INSERT INTO outbox_events
        (aggregate_type, aggregate_id, aggregate_version, event_type, payload, occurred_at, available_at)
        VALUES ('fuel_inventory', ${airlineId}::uuid, ${BigInt(context.version) + 1n}::bigint,
          'fuel.purchased.v1', ${JSON.stringify({ airlineId, quoteId, lotId, movementId, quantityKg: quantity.toString(), totalPriceMinor: total.toString(), currency: context.currency })}::jsonb,
          ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)`.execute(
          transaction,
        );
        const updated = await contextRow(transaction, playerAccountId, airlineId);
        const quote = quoteFromRow(quoteRow);
        const result: FuelPurchase = {
          quote,
          lot: {
            id: lotId,
            quoteId,
            quantityKg: quantity.toString(),
            costBasisMinor: total.toString(),
            derivedRemainingQuantityKg: quantity.toString(),
            derivedRemainingCostMinor: total.toString(),
            currency: context.currency,
            unitPriceNumerator: String(quoteRow.unit_price_numerator),
            unitPriceDenominator: String(quoteRow.unit_price_denominator),
            fuelRulesVersion: String(quoteRow.fuel_rules_version),
            priceFormulaVersion: String(quoteRow.price_formula_version),
            appliedFxSnapshot: { importId: null, numerator: "1", denominator: "1" },
            purchasedAt: now.toISOString(),
            provenance: {
              source: "deterministic-offline-global-market",
              bucketStart: (quoteRow.time_bucket_start as Date).toISOString(),
            },
          },
          inventory: inventoryFromContext(updated),
          journalEntryId: journal.journalEntryId,
          movementId,
        };
        await completeIdempotency(transaction, scope, idempotencyKey, result);
        return result;
      },
      { isolationLevel: "serializable", maximumAttempts: 5 },
    );
  }

  public async inventory(playerAccountId: string, airlineId: string): Promise<FuelInventory> {
    return inventoryFromContext(await contextRow(this.database, playerAccountId, airlineId));
  }

  public async lots(playerAccountId: string, airlineId: string): Promise<readonly FuelLot[]> {
    const context = await contextRow(this.database, playerAccountId, airlineId);
    const result = await sql<Record<string, unknown>>`SELECT l.id, l.quote_id, l.quantity_kg::text,
      l.cost_basis_minor::text, l.currency, l.unit_price_numerator::text,
      l.unit_price_denominator::text, l.fuel_ruleset_version, l.price_formula_version,
      l.exchange_rate_import_id, l.exchange_rate_numerator::text,
      l.exchange_rate_denominator::text, l.purchased_at, l.provenance,
      (SELECT COALESCE(sum(quantity_kg), 0)::text FROM fuel_purchase_lots WHERE airline_id = ${airlineId}::uuid) AS total_purchased
      FROM fuel_purchase_lots l WHERE l.airline_id = ${airlineId}::uuid ORDER BY l.purchased_at, l.id`.execute(
      this.database,
    );
    const onHand = BigInt(context.on_hand_kg);
    const value = BigInt(context.inventory_value_minor);
    return result.rows.map((row) => {
      const totalPurchased = BigInt(String(row.total_purchased));
      const quantity = BigInt(String(row.quantity_kg));
      const cost = BigInt(String(row.cost_basis_minor));
      return {
        id: String(row.id),
        quoteId: String(row.quote_id),
        quantityKg: quantity.toString(),
        costBasisMinor: cost.toString(),
        derivedRemainingQuantityKg:
          totalPurchased === 0n ? "0" : ((quantity * onHand) / totalPurchased).toString(),
        derivedRemainingCostMinor:
          totalPurchased === 0n
            ? "0"
            : (
                (cost * value) /
                (result.rows.reduce(
                  (sum, item) => sum + BigInt(String(item.cost_basis_minor)),
                  0n,
                ) || 1n)
              ).toString(),
        currency: row.currency as CurrencyCode,
        unitPriceNumerator: String(row.unit_price_numerator),
        unitPriceDenominator: String(row.unit_price_denominator),
        fuelRulesVersion: String(row.fuel_ruleset_version),
        priceFormulaVersion: String(row.price_formula_version),
        appliedFxSnapshot: {
          importId: row.exchange_rate_import_id ? String(row.exchange_rate_import_id) : null,
          numerator: String(row.exchange_rate_numerator),
          denominator: String(row.exchange_rate_denominator),
        },
        purchasedAt: (row.purchased_at as Date).toISOString(),
        provenance: row.provenance as Record<string, unknown>,
      };
    });
  }

  public async movements(
    playerAccountId: string,
    airlineId: string,
  ): Promise<readonly FuelMovement[]> {
    await contextRow(this.database, playerAccountId, airlineId);
    const result = await sql<
      Record<string, unknown>
    >`SELECT id, movement_type, quantity_delta_kg::text,
      reserved_delta_kg::text, inventory_value_delta_minor::text, balance_after_kg::text,
      reserved_after_kg::text, inventory_value_after_minor::text, source_type, source_id,
      reverses_movement_id, occurred_at FROM fuel_inventory_movements
      WHERE airline_id = ${airlineId}::uuid ORDER BY occurred_at DESC, id DESC`.execute(
      this.database,
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      type: row.movement_type as FuelMovement["type"],
      quantityDeltaKg: String(row.quantity_delta_kg),
      reservedDeltaKg: String(row.reserved_delta_kg),
      inventoryValueDeltaMinor: String(row.inventory_value_delta_minor),
      balanceAfterKg: String(row.balance_after_kg),
      reservedAfterKg: String(row.reserved_after_kg),
      inventoryValueAfterMinor: String(row.inventory_value_after_minor),
      sourceType: String(row.source_type),
      sourceId: String(row.source_id),
      reversesMovementId: row.reverses_movement_id ? String(row.reverses_movement_id) : null,
      occurredAt: (row.occurred_at as Date).toISOString(),
    }));
  }

  public setReserve(
    playerAccountId: string,
    airlineId: string,
    reservedKg: bigint,
    idempotencyKey: string,
    now: Date,
  ): Promise<FuelInventory> {
    if (reservedKg < 0n)
      throw new FuelDomainError("invalid_fuel_quantity", "Planning reserve cannot be negative.");
    const scope = `fuel-reserve:${airlineId}`;
    const hash = requestHash({ airlineId, reservedKg: reservedKg.toString() });
    return runInTransaction(
      this.database,
      async (transaction) => {
        const existing = await beginIdempotency(
          transaction,
          scope,
          idempotencyKey,
          "fuel_reserve",
          hash,
        );
        if (existing) return existing as FuelInventory;
        const context = await contextRow(transaction, playerAccountId, airlineId, true);
        if (reservedKg > BigInt(context.on_hand_kg))
          throw new FuelDomainError(
            "fuel_reserve_exceeds_inventory",
            "Planning reserve cannot exceed on-hand fuel.",
          );
        const previous = BigInt(context.planning_reserved_kg);
        const delta = reservedKg - previous;
        await sql`UPDATE airline_fuel_inventories SET planning_reserved_kg = ${reservedKg.toString()}::bigint,
        version = version + 1, updated_at = ${now.toISOString()}::timestamptz WHERE airline_id = ${airlineId}::uuid`.execute(
          transaction,
        );
        await sql`INSERT INTO fuel_inventory_movements
        (airline_id, movement_type, quantity_delta_kg, reserved_delta_kg, inventory_value_delta_minor,
         balance_after_kg, reserved_after_kg, inventory_value_after_minor, source_type, source_id,
         source_idempotency_key, occurred_at)
        VALUES (${airlineId}::uuid, ${delta >= 0n ? "reservation" : "release"}, 0,
          ${delta.toString()}::bigint, 0, ${context.on_hand_kg}::bigint, ${reservedKg.toString()}::bigint,
          ${context.inventory_value_minor}::bigint, 'planning_policy', ${airlineId},
          ${idempotencyKey}, ${now.toISOString()}::timestamptz)`.execute(transaction);
        await sql`INSERT INTO outbox_events
        (aggregate_type, aggregate_id, aggregate_version, event_type, payload, occurred_at, available_at)
        VALUES ('fuel_inventory', ${airlineId}::uuid, ${BigInt(context.version) + 1n}::bigint,
          'fuel.reserve_changed.v1', ${JSON.stringify({ airlineId, planningReservedKg: reservedKg.toString() })}::jsonb,
          ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)`.execute(
          transaction,
        );
        const result = inventoryFromContext(
          await contextRow(transaction, playerAccountId, airlineId),
        );
        await completeIdempotency(transaction, scope, idempotencyKey, result);
        return result;
      },
      { isolationLevel: "serializable", maximumAttempts: 5 },
    );
  }

  public async forecast(
    playerAccountId: string,
    airlineId: string,
    projectedConsumptionKg: bigint,
  ): Promise<FuelForecast> {
    const row = await contextRow(this.database, playerAccountId, airlineId);
    return forecastFuel(
      airlineId,
      BigInt(row.on_hand_kg),
      BigInt(row.planning_reserved_kg),
      BigInt(row.minimum_reserve_kg),
      projectedConsumptionKg,
    );
  }

  public async capacityOffers(
    playerAccountId: string,
    airlineId: string,
  ): Promise<readonly FuelCapacityOffer[]> {
    const context = await contextRow(this.database, playerAccountId, airlineId);
    const result = await sql<{
      tier: number;
      capacity_kg: string;
      prices: unknown;
    }>`SELECT tier, capacity_kg::text, upgrade_price_minor AS prices
      FROM fuel_capacity_tiers WHERE fuel_ruleset_version_id = ${context.fuel_rules_id}::uuid
      AND tier > ${context.capacity_tier} ORDER BY tier`.execute(this.database);
    return result.rows.map((row) => ({
      tier: row.tier,
      capacityKg: row.capacity_kg,
      incrementalCapacityKg: (BigInt(row.capacity_kg) - BigInt(context.capacity_kg)).toString(),
      currency: context.currency,
      priceMinor: exactMapValue(row.prices, context.currency, "Capacity upgrade price").toString(),
      fuelRulesVersion: context.fuel_rules_version,
    }));
  }

  public purchaseCapacity(
    playerAccountId: string,
    airlineId: string,
    tier: number,
    idempotencyKey: string,
    now: Date,
  ): Promise<FuelCapacityUpgrade> {
    const scope = `fuel-capacity:${airlineId}`;
    const hash = requestHash({ airlineId, tier });
    return runInTransaction(
      this.database,
      async (transaction) => {
        const existing = await beginIdempotency(
          transaction,
          scope,
          idempotencyKey,
          "fuel_capacity",
          hash,
        );
        if (existing) return existing as FuelCapacityUpgrade;
        const context = await contextRow(transaction, playerAccountId, airlineId, true);
        if (tier !== context.capacity_tier + 1)
          throw new FuelDomainError(
            "fuel_upgrade_not_next_tier",
            "Capacity upgrades must be applied one published tier at a time.",
          );
        const offer = await sql<{
          id: string;
          capacity_kg: string;
          prices: unknown;
        }>`SELECT id, capacity_kg::text, upgrade_price_minor AS prices
        FROM fuel_capacity_tiers WHERE fuel_ruleset_version_id = ${context.fuel_rules_id}::uuid AND tier = ${tier}`.execute(
          transaction,
        );
        const next = offer.rows[0];
        if (!next)
          throw new FuelDomainError(
            "fuel_upgrade_not_found",
            "Fuel capacity upgrade is unavailable.",
          );
        const price = exactMapValue(next.prices, context.currency, "Capacity upgrade price");
        const book = await ledgerBook(transaction, airlineId, now);
        if ((await cashBalance(transaction, airlineId)) < price)
          throw new FuelDomainError(
            "insufficient_cash",
            "Airline cash is insufficient for this capacity upgrade.",
          );
        const journal = await new KyselyLedgerRepository(transaction, true).post({
          ledgerBookId: book.id,
          accountingPeriodId: book.period_id,
          idempotencyKey: `${idempotencyKey}:ledger`,
          commandType: "fuel",
          cashFlowActivity: "investing",
          description: `Global fuel storage capacity tier ${tier}`,
          occurredAt: now,
          transactionCurrency: context.currency,
          reportingCurrency: context.currency,
          postings: [
            {
              accountCode: "1500",
              side: "debit",
              transactionAmountMinor: price,
              reportingAmountMinor: price,
              dimensions: { airlineId },
            },
            {
              accountCode: "1000",
              side: "credit",
              transactionAmountMinor: price,
              reportingAmountMinor: price,
              dimensions: { airlineId },
            },
          ],
        });
        await sql`UPDATE airline_fuel_inventories SET capacity_tier_id = ${next.id}::uuid,
        version = version + 1, updated_at = ${now.toISOString()}::timestamptz WHERE airline_id = ${airlineId}::uuid`.execute(
          transaction,
        );
        await sql`INSERT INTO fuel_capacity_history
        (airline_id, from_tier_id, to_tier_id, price_minor, currency, ledger_journal_entry_id,
         source_idempotency_key, applied_at) VALUES (${airlineId}::uuid,
          ${context.capacity_tier_id}::uuid, ${next.id}::uuid, ${price.toString()}::bigint,
          ${context.currency}, ${journal.journalEntryId}::uuid, ${idempotencyKey}, ${now.toISOString()}::timestamptz)`.execute(
          transaction,
        );
        await sql`INSERT INTO fuel_inventory_movements
        (airline_id, movement_type, quantity_delta_kg, inventory_value_delta_minor,
         balance_after_kg, reserved_after_kg, inventory_value_after_minor, source_type,
         source_id, source_idempotency_key, ledger_journal_entry_id, occurred_at, metadata)
        VALUES (${airlineId}::uuid, 'capacity_adjustment', 0, 0, ${context.on_hand_kg}::bigint,
          ${context.planning_reserved_kg}::bigint, ${context.inventory_value_minor}::bigint,
          'capacity_tier', ${next.id}, ${idempotencyKey}, ${journal.journalEntryId}::uuid,
          ${now.toISOString()}::timestamptz, ${JSON.stringify({ fromTier: context.capacity_tier, toTier: tier, capacityKg: next.capacity_kg })}::jsonb)`.execute(
          transaction,
        );
        await sql`INSERT INTO outbox_events
        (aggregate_type, aggregate_id, aggregate_version, event_type, payload, occurred_at, available_at)
        VALUES ('fuel_inventory', ${airlineId}::uuid, ${BigInt(context.version) + 1n}::bigint,
          'fuel.capacity_upgraded.v1', ${JSON.stringify({ airlineId, fromTier: context.capacity_tier, toTier: tier, capacityKg: next.capacity_kg, priceMinor: price.toString(), currency: context.currency })}::jsonb,
          ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)`.execute(
          transaction,
        );
        const result: FuelCapacityUpgrade = {
          airlineId,
          fromTier: context.capacity_tier,
          toTier: tier,
          capacityKg: next.capacity_kg,
          priceMinor: price.toString(),
          currency: context.currency,
          journalEntryId: journal.journalEntryId,
          inventory: inventoryFromContext(
            await contextRow(transaction, playerAccountId, airlineId),
          ),
        };
        await completeIdempotency(transaction, scope, idempotencyKey, result);
        return result;
      },
      { isolationLevel: "serializable", maximumAttempts: 5 },
    );
  }

  public consume(
    airlineId: string,
    quantityKg: bigint,
    sourceType: string,
    sourceId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<FuelInventory> {
    if (quantityKg <= 0n)
      throw new FuelDomainError(
        "invalid_fuel_quantity",
        "Fuel burn must be positive whole kilograms.",
      );
    const scope = `fuel-consumption:${airlineId}`;
    const hash = requestHash({
      airlineId,
      quantityKg: quantityKg.toString(),
      sourceType,
      sourceId,
    });
    return runInTransaction(
      this.database,
      async (transaction) => {
        const existing = await beginIdempotency(
          transaction,
          scope,
          idempotencyKey,
          "fuel_consumption",
          hash,
        );
        if (existing) return existing as FuelInventory;
        const context = await contextRow(transaction, undefined, airlineId, true);
        const onHand = BigInt(context.on_hand_kg);
        if (quantityKg > onHand)
          throw new FuelDomainError(
            "insufficient_fuel",
            "Fuel burn exceeds authoritative on-hand inventory.",
          );
        const value = weightedConsumptionCost(
          onHand,
          BigInt(context.inventory_value_minor),
          quantityKg,
        );
        const nextQuantity = onHand - quantityKg;
        const nextValue = BigInt(context.inventory_value_minor) - value;
        const nextReserved =
          BigInt(context.planning_reserved_kg) > nextQuantity
            ? nextQuantity
            : BigInt(context.planning_reserved_kg);
        const book = await ledgerBook(transaction, airlineId, now);
        let journalEntryId: string | undefined;
        if (value > 0n) {
          journalEntryId = (
            await new KyselyLedgerRepository(transaction, true).post({
              ledgerBookId: book.id,
              accountingPeriodId: book.period_id,
              idempotencyKey: `${idempotencyKey}:ledger`,
              commandType: "fuel",
              description: "Global fuel consumption",
              occurredAt: now,
              transactionCurrency: context.currency,
              reportingCurrency: context.currency,
              postings: [
                {
                  accountCode: "5000",
                  side: "debit",
                  transactionAmountMinor: value,
                  reportingAmountMinor: value,
                  dimensions: { airlineId },
                },
                {
                  accountCode: "1200",
                  side: "credit",
                  transactionAmountMinor: value,
                  reportingAmountMinor: value,
                  dimensions: { airlineId },
                },
              ],
            })
          ).journalEntryId;
        }
        const movementId = randomUUID();
        await sql`UPDATE airline_fuel_inventories SET on_hand_kg = ${nextQuantity.toString()}::bigint,
        planning_reserved_kg = ${nextReserved.toString()}::bigint, inventory_value_minor = ${nextValue.toString()}::bigint,
        version = version + 1, updated_at = ${now.toISOString()}::timestamptz WHERE airline_id = ${airlineId}::uuid`.execute(
          transaction,
        );
        await sql`INSERT INTO fuel_inventory_movements
        (id, airline_id, movement_type, quantity_delta_kg, reserved_delta_kg, inventory_value_delta_minor,
         balance_after_kg, reserved_after_kg, inventory_value_after_minor, source_type, source_id,
         source_idempotency_key, ledger_journal_entry_id, occurred_at)
        VALUES (${movementId}::uuid, ${airlineId}::uuid, 'consumption', ${(-quantityKg).toString()}::bigint,
          ${(nextReserved - BigInt(context.planning_reserved_kg)).toString()}::bigint, ${(-value).toString()}::bigint,
          ${nextQuantity.toString()}::bigint, ${nextReserved.toString()}::bigint, ${nextValue.toString()}::bigint,
          ${sourceType}, ${sourceId}, ${idempotencyKey}, ${journalEntryId ?? null}::uuid,
          ${now.toISOString()}::timestamptz)`.execute(transaction);
        await sql`INSERT INTO outbox_events
        (aggregate_type, aggregate_id, aggregate_version, event_type, payload, occurred_at, available_at)
        VALUES ('fuel_inventory', ${airlineId}::uuid, ${BigInt(context.version) + 1n}::bigint,
          'fuel.consumed.v1', ${JSON.stringify({ airlineId, movementId, quantityKg: quantityKg.toString(), inventoryCostMinor: value.toString(), sourceType, sourceId })}::jsonb,
          ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)`.execute(
          transaction,
        );
        const result = inventoryFromContext(await contextRow(transaction, undefined, airlineId));
        await completeIdempotency(transaction, scope, idempotencyKey, result);
        return result;
      },
      { isolationLevel: "serializable", maximumAttempts: 5 },
    );
  }

  public correct(
    airlineId: string,
    quantityDeltaKg: bigint,
    valueDeltaMinor: bigint,
    sourceId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<FuelInventory> {
    const scope = `fuel-correction:${airlineId}`;
    const hash = requestHash({
      airlineId,
      quantityDeltaKg: quantityDeltaKg.toString(),
      valueDeltaMinor: valueDeltaMinor.toString(),
      sourceId,
    });
    return runInTransaction(
      this.database,
      async (transaction) => {
        const existing = await beginIdempotency(
          transaction,
          scope,
          idempotencyKey,
          "fuel_correction",
          hash,
        );
        if (existing) return existing as FuelInventory;
        const context = await contextRow(transaction, undefined, airlineId, true);
        const quantity = BigInt(context.on_hand_kg) + quantityDeltaKg;
        const value = BigInt(context.inventory_value_minor) + valueDeltaMinor;
        if (quantity < 0n || value < 0n)
          throw new FuelDomainError(
            "insufficient_fuel",
            "Fuel correction would make authoritative inventory negative.",
          );
        if (quantity > BigInt(context.capacity_kg))
          throw new FuelDomainError(
            "fuel_capacity_exceeded",
            "Fuel correction would exceed storage capacity.",
          );
        if ((quantityDeltaKg === 0n) !== (valueDeltaMinor === 0n))
          throw new FuelDomainError(
            "invalid_fuel_quantity",
            "A correction must state both physical and valuation effects.",
          );
        let journalEntryId: string | undefined;
        if (valueDeltaMinor !== 0n) {
          const amount = valueDeltaMinor < 0n ? -valueDeltaMinor : valueDeltaMinor;
          const book = await ledgerBook(transaction, airlineId, now);
          journalEntryId = (
            await new KyselyLedgerRepository(transaction, true).post({
              ledgerBookId: book.id,
              accountingPeriodId: book.period_id,
              idempotencyKey: `${idempotencyKey}:ledger`,
              commandType: "adjustment",
              entryKind: "adjustment",
              description: "Explicit global fuel inventory correction",
              occurredAt: now,
              transactionCurrency: context.currency,
              reportingCurrency: context.currency,
              postings:
                valueDeltaMinor > 0n
                  ? [
                      {
                        accountCode: "1200",
                        side: "debit",
                        transactionAmountMinor: amount,
                        reportingAmountMinor: amount,
                        dimensions: { airlineId },
                      },
                      {
                        accountCode: "5900",
                        side: "credit",
                        transactionAmountMinor: amount,
                        reportingAmountMinor: amount,
                        dimensions: { airlineId },
                      },
                    ]
                  : [
                      {
                        accountCode: "5900",
                        side: "debit",
                        transactionAmountMinor: amount,
                        reportingAmountMinor: amount,
                        dimensions: { airlineId },
                      },
                      {
                        accountCode: "1200",
                        side: "credit",
                        transactionAmountMinor: amount,
                        reportingAmountMinor: amount,
                        dimensions: { airlineId },
                      },
                    ],
            })
          ).journalEntryId;
        }
        const reserved =
          BigInt(context.planning_reserved_kg) > quantity
            ? quantity
            : BigInt(context.planning_reserved_kg);
        await sql`UPDATE airline_fuel_inventories SET on_hand_kg = ${quantity.toString()}::bigint,
        planning_reserved_kg = ${reserved.toString()}::bigint, inventory_value_minor = ${value.toString()}::bigint,
        version = version + 1, updated_at = ${now.toISOString()}::timestamptz WHERE airline_id = ${airlineId}::uuid`.execute(
          transaction,
        );
        await sql`INSERT INTO fuel_inventory_movements
        (airline_id, movement_type, quantity_delta_kg, reserved_delta_kg, inventory_value_delta_minor,
         balance_after_kg, reserved_after_kg, inventory_value_after_minor, source_type, source_id,
         source_idempotency_key, ledger_journal_entry_id, occurred_at)
        VALUES (${airlineId}::uuid, 'correction', ${quantityDeltaKg.toString()}::bigint,
          ${(reserved - BigInt(context.planning_reserved_kg)).toString()}::bigint, ${valueDeltaMinor.toString()}::bigint,
          ${quantity.toString()}::bigint, ${reserved.toString()}::bigint, ${value.toString()}::bigint,
          'administrative_correction', ${sourceId}, ${idempotencyKey}, ${journalEntryId ?? null}::uuid,
          ${now.toISOString()}::timestamptz)`.execute(transaction);
        await sql`INSERT INTO outbox_events
        (aggregate_type, aggregate_id, aggregate_version, event_type, payload, occurred_at, available_at)
        VALUES ('fuel_inventory', ${airlineId}::uuid, ${BigInt(context.version) + 1n}::bigint,
          'fuel.corrected.v1', ${JSON.stringify({ airlineId, quantityDeltaKg: quantityDeltaKg.toString(), valueDeltaMinor: valueDeltaMinor.toString(), sourceId })}::jsonb,
          ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)`.execute(
          transaction,
        );
        const result = inventoryFromContext(await contextRow(transaction, undefined, airlineId));
        await completeIdempotency(transaction, scope, idempotencyKey, result);
        return result;
      },
      { isolationLevel: "serializable", maximumAttempts: 5 },
    );
  }

  public reverseMovement(
    airlineId: string,
    movementId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<FuelInventory> {
    const scope = `fuel-reversal:${airlineId}`;
    const hash = requestHash({ airlineId, movementId });
    return runInTransaction(
      this.database,
      async (transaction) => {
        const existing = await beginIdempotency(
          transaction,
          scope,
          idempotencyKey,
          "fuel_reversal",
          hash,
        );
        if (existing) return existing as FuelInventory;
        const context = await contextRow(transaction, undefined, airlineId, true);
        const original = await sql<{
          quantity: string;
          reserved: string;
          value: string;
          journal: string | null;
          type: string;
        }>`SELECT quantity_delta_kg::text AS quantity,
        reserved_delta_kg::text AS reserved, inventory_value_delta_minor::text AS value,
        ledger_journal_entry_id AS journal, movement_type AS type FROM fuel_inventory_movements
        WHERE id = ${movementId}::uuid AND airline_id = ${airlineId}::uuid FOR UPDATE`.execute(
          transaction,
        );
        const movement = original.rows[0];
        if (!movement)
          throw new FuelDomainError("fuel_movement_not_found", "Fuel movement is unavailable.");
        if (movement.type === "reversal" || movement.type === "capacity_adjustment")
          throw new FuelDomainError(
            "fuel_movement_already_reversed",
            "This fuel movement cannot be reversed.",
          );
        const reversed = await sql<{
          exists: boolean;
        }>`SELECT EXISTS (SELECT 1 FROM fuel_inventory_movements WHERE reverses_movement_id = ${movementId}::uuid) AS exists`.execute(
          transaction,
        );
        if (reversed.rows[0]?.exists)
          throw new FuelDomainError(
            "fuel_movement_already_reversed",
            "Fuel movement already has a reversal.",
          );
        const quantityDelta = -BigInt(movement.quantity);
        const reservedDelta = -BigInt(movement.reserved);
        const valueDelta = -BigInt(movement.value);
        const quantity = BigInt(context.on_hand_kg) + quantityDelta;
        const reserved = BigInt(context.planning_reserved_kg) + reservedDelta;
        const value = BigInt(context.inventory_value_minor) + valueDelta;
        if (quantity < 0n || reserved < 0n || reserved > quantity || value < 0n)
          throw new FuelDomainError(
            "insufficient_fuel",
            "Reversal would violate authoritative inventory balances.",
          );
        if (quantity > BigInt(context.capacity_kg))
          throw new FuelDomainError(
            "fuel_capacity_exceeded",
            "Reversal would exceed storage capacity.",
          );
        let reversalJournal: string | undefined;
        if (movement.journal) {
          const book = await ledgerBook(transaction, airlineId, now);
          reversalJournal = (
            await new KyselyLedgerRepository(transaction, true).reverse(
              book.id,
              movement.journal,
              book.period_id,
              now,
              `${idempotencyKey}:ledger`,
              "Explicit fuel movement reversal",
            )
          ).journalEntryId;
        }
        await sql`UPDATE airline_fuel_inventories SET on_hand_kg = ${quantity.toString()}::bigint,
        planning_reserved_kg = ${reserved.toString()}::bigint, inventory_value_minor = ${value.toString()}::bigint,
        version = version + 1, updated_at = ${now.toISOString()}::timestamptz WHERE airline_id = ${airlineId}::uuid`.execute(
          transaction,
        );
        await sql`INSERT INTO fuel_inventory_movements
        (airline_id, movement_type, quantity_delta_kg, reserved_delta_kg, inventory_value_delta_minor,
         balance_after_kg, reserved_after_kg, inventory_value_after_minor, source_type, source_id,
         source_idempotency_key, reverses_movement_id, ledger_journal_entry_id, occurred_at)
        VALUES (${airlineId}::uuid, 'reversal', ${quantityDelta.toString()}::bigint,
          ${reservedDelta.toString()}::bigint, ${valueDelta.toString()}::bigint,
          ${quantity.toString()}::bigint, ${reserved.toString()}::bigint, ${value.toString()}::bigint,
          'fuel_movement', ${movementId}, ${idempotencyKey}, ${movementId}::uuid,
          ${reversalJournal ?? null}::uuid, ${now.toISOString()}::timestamptz)`.execute(
          transaction,
        );
        await sql`INSERT INTO outbox_events
        (aggregate_type, aggregate_id, aggregate_version, event_type, payload, occurred_at, available_at)
        VALUES ('fuel_inventory', ${airlineId}::uuid, ${BigInt(context.version) + 1n}::bigint,
          'fuel.movement_reversed.v1', ${JSON.stringify({ airlineId, movementId })}::jsonb,
          ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)`.execute(
          transaction,
        );
        const result = inventoryFromContext(await contextRow(transaction, undefined, airlineId));
        await completeIdempotency(transaction, scope, idempotencyKey, result);
        return result;
      },
      { isolationLevel: "serializable", maximumAttempts: 5 },
    );
  }
}
