import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FoundingSelection } from "@airline-manager/domain";
import { KyselyAirlineFoundingRepository } from "../airline/repository.js";
import { seedSliceOneCatalog } from "../catalog/seed.js";
import { readDatabasePoolOptions } from "../config.js";
import { createDatabaseRuntime, type DatabaseRuntime } from "../database.js";
import { KyselyFuelRepository } from "./repository.js";

let runtime: DatabaseRuntime;
const now = new Date("2026-07-11T12:00:00.000Z");

async function createPlayer(): Promise<string> {
  const user = await sql<{ id: string }>`INSERT INTO auth_user (name, email, "emailVerified")
    VALUES ('Fuel Test', ${`fuel-${randomUUID()}@example.test`}, true) RETURNING id`.execute(
    runtime.database,
  );
  const player = await sql<{ id: string }>`SELECT id FROM player_accounts
    WHERE authentication_user_id = ${user.rows[0]?.id}::uuid`.execute(runtime.database);
  if (!player.rows[0]?.id) throw new Error("Fuel test player was not created.");
  return player.rows[0].id;
}

function selection(): FoundingSelection {
  return {
    airlineName: `Fuel ${randomUUID().slice(0, 8)}`,
    fictionalIdentityConfirmed: true,
    homeJurisdiction: "US",
    principalBaseIataCode: "JFK",
    reportingCurrency: "USD",
    brand: { primaryColor: "#112233", secondaryColor: "#DDEEFF", logoMark: "FU" },
    acceptFoundingLoan: false,
    worldRulesetVersion: "contemporary-2026.07.11",
  };
}

async function foundCareer() {
  const playerId = await createPlayer();
  const founded = await new KyselyAirlineFoundingRepository(runtime.database).confirm(
    playerId,
    selection(),
    `found-${randomUUID()}`,
    now,
  );
  return { playerId, founded, repository: new KyselyFuelRepository(runtime.database) };
}

beforeAll(async () => {
  runtime = createDatabaseRuntime(readDatabasePoolOptions("test"));
  await seedSliceOneCatalog(runtime.database);
});

beforeEach(async () => {
  await sql`TRUNCATE game_worlds, ledger_books, auth_user, idempotency_commands, outbox_events CASCADE`.execute(
    runtime.database,
  );
});

afterAll(async () => runtime.destroy());

describe("PostgreSQL global fuel inventory and market", () => {
  it("creates one global kilogram inventory and deterministic versioned recent prices", async () => {
    const { playerId, founded, repository } = await foundCareer();
    const inventory = await repository.inventory(playerId, founded.airlineId);
    expect(inventory).toMatchObject({
      unit: "kg",
      onHandKg: "0",
      capacityKg: "100000",
      capacityTier: 1,
      minimumReserveKg: "5000",
      currency: "USD",
    });
    const first = await repository.currentPrices(playerId, founded.airlineId, now, 3);
    const repeated = await repository.currentPrices(playerId, founded.airlineId, now, 3);
    expect(repeated).toEqual(first);
    expect(first).toHaveLength(3);
    expect(first[0]).toMatchObject({
      rulesetVersion: "contemporary-2026.07.11",
      fuelRulesVersion: "fuel-v1",
      priceFormulaVersion: "seeded-bucket-fnv1a64-v1",
    });
  });

  it("expires immutable quotes and denies foreign-airline quote substitution", async () => {
    const owner = await foundCareer();
    const foreign = await foundCareer();
    const quote = await owner.repository.createQuote(
      owner.playerId,
      owner.founded.airlineId,
      1_000n,
      now,
    );
    await expect(
      owner.repository.purchase(
        owner.playerId,
        owner.founded.airlineId,
        quote.id,
        "expired-quote",
        new Date("2026-07-11T12:05:00.001Z"),
      ),
    ).rejects.toMatchObject({ code: "fuel_quote_expired" });
    await expect(
      foreign.repository.purchase(
        foreign.playerId,
        foreign.founded.airlineId,
        quote.id,
        "foreign-quote",
        now,
      ),
    ).rejects.toMatchObject({ code: "fuel_quote_wrong_airline" });
  });

  it("purchases atomically and idempotently with exact lot, movement, ledger, and outbox reconciliation", async () => {
    const { playerId, founded, repository } = await foundCareer();
    const quote = await repository.createQuote(playerId, founded.airlineId, 10_000n, now);
    const [first, repeated] = await Promise.all([
      repository.purchase(playerId, founded.airlineId, quote.id, "same-purchase", now),
      repository.purchase(playerId, founded.airlineId, quote.id, "same-purchase", now),
    ]);
    expect(repeated).toEqual(first);
    expect(first.inventory).toMatchObject({
      onHandKg: "10000",
      inventoryValueMinor: quote.totalPriceMinor,
    });
    expect(await repository.lots(playerId, founded.airlineId)).toHaveLength(1);
    expect((await repository.movements(playerId, founded.airlineId))[0]).toMatchObject({
      type: "purchase",
      quantityDeltaKg: "10000",
      inventoryValueDeltaMinor: quote.totalPriceMinor,
    });
    const check = await sql<{ asset: string; events: string; lots: string }>`SELECT
      (SELECT COALESCE(sum(CASE p.side WHEN 'debit' THEN p.reporting_amount_minor ELSE -p.reporting_amount_minor END), 0)::text
       FROM ledger_postings p JOIN ledger_accounts a ON a.id = p.account_id WHERE a.code = '1200' AND p.airline_id = ${founded.airlineId}::uuid) AS asset,
      (SELECT count(*)::text FROM outbox_events WHERE aggregate_id = ${founded.airlineId}::uuid AND event_type = 'fuel.purchased.v1') AS events,
      (SELECT count(*)::text FROM fuel_purchase_lots WHERE airline_id = ${founded.airlineId}::uuid) AS lots`.execute(
      runtime.database,
    );
    expect(check.rows[0]).toEqual({ asset: quote.totalPriceMinor, events: "1", lots: "1" });
  });

  it("serializes concurrent capacity contention and never exceeds the ceiling", async () => {
    const { playerId, founded, repository } = await foundCareer();
    const left = await repository.createQuote(playerId, founded.airlineId, 60_000n, now);
    const right = await repository.createQuote(playerId, founded.airlineId, 60_000n, now);
    const results = await Promise.allSettled([
      repository.purchase(playerId, founded.airlineId, left.id, "capacity-left", now),
      repository.purchase(playerId, founded.airlineId, right.id, "capacity-right", now),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.find(({ status }) => status === "rejected")).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "fuel_capacity_exceeded" }),
    });
    expect(await repository.inventory(playerId, founded.airlineId)).toMatchObject({
      onHandKg: "60000",
      capacityKg: "100000",
    });
  });

  it("consumes externally supplied burn exactly once, prevents negatives, and reconciles weighted value", async () => {
    const { playerId, founded, repository } = await foundCareer();
    const firstQuote = await repository.createQuote(playerId, founded.airlineId, 20_000n, now);
    const secondQuote = await repository.createQuote(
      playerId,
      founded.airlineId,
      10_000n,
      new Date("2026-07-11T13:00:00Z"),
    );
    await repository.purchase(playerId, founded.airlineId, firstQuote.id, "purchase-one", now);
    await repository.purchase(
      playerId,
      founded.airlineId,
      secondQuote.id,
      "purchase-two",
      new Date("2026-07-11T13:00:00Z"),
    );
    const before = await repository.inventory(playerId, founded.airlineId);
    const consumed = await repository.consume(
      founded.airlineId,
      7_777n,
      "flight_settlement",
      "flight-1",
      "consume-once",
      new Date("2026-07-11T14:00:00Z"),
    );
    expect(
      await repository.consume(
        founded.airlineId,
        7_777n,
        "flight_settlement",
        "flight-1",
        "consume-once",
        new Date("2026-07-11T14:00:00Z"),
      ),
    ).toEqual(consumed);
    expect(consumed.onHandKg).toBe("22223");
    expect(BigInt(consumed.inventoryValueMinor)).toBeLessThan(BigInt(before.inventoryValueMinor));
    await expect(
      repository.consume(
        founded.airlineId,
        99_999n,
        "flight_settlement",
        "flight-2",
        "consume-too-much",
        now,
      ),
    ).rejects.toMatchObject({ code: "insufficient_fuel" });
    const asset = await sql<{
      balance: string;
    }>`SELECT COALESCE(sum(CASE p.side WHEN 'debit' THEN p.reporting_amount_minor ELSE -p.reporting_amount_minor END), 0)::text AS balance
      FROM ledger_postings p JOIN ledger_accounts a ON a.id = p.account_id WHERE a.code = '1200' AND p.airline_id = ${founded.airlineId}::uuid`.execute(
      runtime.database,
    );
    expect(asset.rows[0]?.balance).toBe(consumed.inventoryValueMinor);
  });

  it("keeps reserves and forecasts advisory, supports release, correction, and explicit reversal", async () => {
    const { playerId, founded, repository } = await foundCareer();
    const quote = await repository.createQuote(playerId, founded.airlineId, 20_000n, now);
    await repository.purchase(playerId, founded.airlineId, quote.id, "reserve-purchase", now);
    const reserved = await repository.setReserve(
      playerId,
      founded.airlineId,
      8_000n,
      "reserve",
      now,
    );
    expect(reserved).toMatchObject({
      onHandKg: "20000",
      planningReservedKg: "8000",
      protectedKg: "8000",
      availableKg: "12000",
    });
    expect(await repository.forecast(playerId, founded.airlineId, 15_000n)).toMatchObject({
      projectedOnHandKg: "5000",
      projectedAvailableKg: "0",
      projectedShortageKg: "3000",
      advisoryOnly: true,
    });
    expect(
      (await repository.setReserve(playerId, founded.airlineId, 2_000n, "release", now))
        .planningReservedKg,
    ).toBe("2000");
    await repository.correct(founded.airlineId, 100n, 1_000n, "audit-1", "correction", now);
    const correction = (await repository.movements(playerId, founded.airlineId)).find(
      ({ type }) => type === "correction",
    );
    if (!correction) throw new Error("Correction movement missing.");
    const reversed = await repository.reverseMovement(
      founded.airlineId,
      correction.id,
      "reverse-correction",
      now,
    );
    expect(reversed).toMatchObject({
      onHandKg: "20000",
      planningReservedKg: "2000",
      inventoryValueMinor: quote.totalPriceMinor,
    });
    const types = (await repository.movements(playerId, founded.airlineId)).map(({ type }) => type);
    expect(types).toEqual(
      expect.arrayContaining(["purchase", "reservation", "release", "correction", "reversal"]),
    );
  });

  it("publishes finite upgrades, applies the next tier atomically, and enforces exact cash", async () => {
    const { playerId, founded, repository } = await foundCareer();
    expect(await repository.capacityOffers(playerId, founded.airlineId)).toMatchObject([
      { tier: 2, capacityKg: "250000", priceMinor: "17000000" },
      { tier: 3, capacityKg: "500000", priceMinor: "34000000" },
    ]);
    const upgraded = await repository.purchaseCapacity(
      playerId,
      founded.airlineId,
      2,
      "tier-two",
      now,
    );
    expect(upgraded).toMatchObject({
      fromTier: 1,
      toTier: 2,
      capacityKg: "250000",
      priceMinor: "17000000",
      inventory: { capacityTier: 2 },
    });
    expect(
      await repository.purchaseCapacity(playerId, founded.airlineId, 2, "tier-two", now),
    ).toEqual(upgraded);
    await repository.purchaseCapacity(playerId, founded.airlineId, 3, "tier-three", now);
    const left = await repository.createQuote(playerId, founded.airlineId, 30_000n, now);
    const right = await repository.createQuote(playerId, founded.airlineId, 30_000n, now);
    const cashContention = await Promise.allSettled([
      repository.purchase(playerId, founded.airlineId, left.id, "cash-left", now),
      repository.purchase(playerId, founded.airlineId, right.id, "cash-right", now),
    ]);
    expect(cashContention.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(cashContention.find(({ status }) => status === "rejected")).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "insufficient_cash" }),
    });
    const history = await sql<{
      count: string;
    }>`SELECT count(*)::text AS count FROM fuel_capacity_history WHERE airline_id = ${founded.airlineId}::uuid`.execute(
      runtime.database,
    );
    expect(history.rows[0]?.count).toBe("3");
  });
});
