import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FoundingSelection } from "@airline-manager/domain";
import { KyselyAirlineFoundingRepository } from "../airline/repository.js";
import { seedSliceOneCatalog } from "../catalog/seed.js";
import { readDatabasePoolOptions } from "../config.js";
import { createDatabaseRuntime, type DatabaseRuntime } from "../database.js";
import {
  KyselyFleetRepository,
  fleetMaterialStages,
  type FleetMaterialStage,
} from "./repository.js";

let runtime: DatabaseRuntime;
const now = new Date("2026-07-11T12:00:00.000Z");

async function createPlayer(): Promise<string> {
  const user = await sql<{ id: string }>`INSERT INTO auth_user (name, email, "emailVerified")
    VALUES ('Fleet Test', ${`fleet-${randomUUID()}@example.test`}, true) RETURNING id`.execute(
    runtime.database,
  );
  const player = await sql<{ id: string }>`SELECT id FROM player_accounts
    WHERE authentication_user_id = ${user.rows[0]?.id}::uuid`.execute(runtime.database);
  if (!player.rows[0]?.id) throw new Error("Fleet test player was not created.");
  return player.rows[0].id;
}

function selection(): FoundingSelection {
  return {
    airlineName: `Fleet ${randomUUID().slice(0, 8)}`,
    fictionalIdentityConfirmed: true,
    homeJurisdiction: "US",
    principalBaseIataCode: "JFK",
    reportingCurrency: "USD",
    brand: { primaryColor: "#112233", secondaryColor: "#DDEEFF", logoMark: "FT" },
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
  return { playerId, founded };
}

beforeAll(async () => {
  runtime = createDatabaseRuntime(readDatabasePoolOptions("test"));
  await seedSliceOneCatalog(runtime.database);
});

beforeEach(async () => {
  await sql`TRUNCATE game_worlds, ledger_books, auth_user, idempotency_commands,
    outbox_events CASCADE`.execute(runtime.database);
});

afterAll(async () => runtime.destroy());

describe("PostgreSQL founder lease and fleet", () => {
  it("publishes four viable, explainable, versioned packages with certified economy limits", async () => {
    const { playerId, founded } = await foundCareer();
    const comparison = await new KyselyFleetRepository(runtime.database).listFounderPackage(
      playerId,
      founded.airlineId,
    );
    expect(comparison.packageVersion).toBe("founder-package-v1");
    expect(comparison.options).toHaveLength(4);
    expect(comparison.options.map(({ variant }) => variant.code).sort()).toEqual([
      "airbus-a320neo",
      "atr-72-600",
      "boeing-737-8",
      "embraer-e175",
    ]);
    for (const option of comparison.options) {
      expect(option.viable).toBe(true);
      expect(option.cabin.economySeats).toBeLessThanOrEqual(option.variant.maximumSeats);
      expect(option.cabin.bookingClassesConfigured).toBe(false);
      expect(option.delivery.delayMinutes).toBeLessThanOrEqual(1440);
      expect(Object.values(option.tradeoffs).every((value) => value.length > 20)).toBe(true);
      expect(option.lease.depositMinor).toBe(option.lease.depositSubsidyMinor);
      expect(option.lease.refundableDepositMinor).toBe("0");
    }
  });

  it("accepts atomically and idempotently with exact ledger, schedule, ownership, history, and outbox state", async () => {
    const { playerId, founded } = await foundCareer();
    const repository = new KyselyFleetRepository(runtime.database);
    const [left, right] = await Promise.all([
      repository.acceptFounderLease(
        playerId,
        founded.airlineId,
        "founder-atr-72-600",
        "same-lease",
        now,
      ),
      repository.acceptFounderLease(
        playerId,
        founded.airlineId,
        "founder-atr-72-600",
        "same-lease",
        now,
      ),
    ]);
    expect(right).toEqual(left);
    expect(
      await repository.acceptFounderLease(
        playerId,
        founded.airlineId,
        "founder-atr-72-600",
        "same-lease",
        now,
      ),
    ).toEqual(left);
    expect(left.aircraft).toMatchObject({
      deliveryState: "delivered",
      currentAirportId: left.aircraft.plannedAirportId,
      catalogReleaseVersion: "slice-one-2026.07.11",
      variantCode: "atr-72-600",
      operatorAirlineId: founded.airlineId,
      restrictions: { sale: true, collateral: true, cashExtraction: true },
    });
    expect(left.lease.paymentSchedule).toHaveLength(6);
    expect(left.lease.paymentSchedule.every(({ amountMinor }) => amountMinor === "200000")).toBe(
      true,
    );

    const counts = await sql<{
      leases: string;
      aircraft: string;
      schedules: string;
      histories: string;
      journals: string;
      ownerships: string;
      outbox: string;
      ledger_delta: string;
    }>`SELECT
      (SELECT count(*)::text FROM operating_leases WHERE career_id = ${founded.careerId}::uuid) AS leases,
      (SELECT count(*)::text FROM aircraft WHERE operating_lease_id = ${left.lease.id}::uuid) AS aircraft,
      (SELECT count(*)::text FROM operating_lease_payment_schedule WHERE lease_id = ${left.lease.id}::uuid) AS schedules,
      (SELECT count(*)::text FROM aircraft_lifecycle_events WHERE aircraft_id = ${left.aircraft.id}::uuid) AS histories,
      (SELECT count(*)::text FROM journal_entries j JOIN ledger_postings p ON p.journal_entry_id = j.id
        WHERE p.contract_id = ${left.lease.id}::uuid AND p.line_number = 1) AS journals,
      (SELECT count(*)::text FROM resource_ownerships WHERE resource_type = 'aircraft'
        AND resource_id = ${left.aircraft.id}::uuid) AS ownerships,
      (SELECT count(*)::text FROM outbox_events WHERE aggregate_id = ${left.aircraft.id}::uuid) AS outbox,
      (SELECT COALESCE(sum(CASE p.side WHEN 'debit' THEN p.reporting_amount_minor ELSE -p.reporting_amount_minor END), 0)::text
        FROM ledger_postings p WHERE p.contract_id = ${left.lease.id}::uuid) AS ledger_delta`.execute(
      runtime.database,
    );
    expect(counts.rows[0]).toEqual({
      leases: "1",
      aircraft: "1",
      schedules: "6",
      histories: "2",
      journals: "2",
      ownerships: "1",
      outbox: "1",
      ledger_delta: "0",
    });
    const cash = await sql<{
      amount: string;
    }>`SELECT COALESCE(sum(CASE p.side WHEN 'debit' THEN p.reporting_amount_minor
      ELSE -p.reporting_amount_minor END), 0)::text AS amount FROM ledger_postings p
      JOIN ledger_accounts a ON a.id = p.account_id WHERE a.code = '1000' AND p.airline_id = ${founded.airlineId}::uuid`.execute(
      runtime.database,
    );
    expect(cash.rows[0]?.amount).toBe("55000000");
  });

  it("enforces exactly one acceptance under different concurrent commands and rolls back invalid selection", async () => {
    const { playerId, founded } = await foundCareer();
    const repository = new KyselyFleetRepository(runtime.database);
    await expect(
      repository.acceptFounderLease(playerId, founded.airlineId, "missing-option", "invalid", now),
    ).rejects.toMatchObject({ code: "founder_option_not_found" });
    const invalidCount = await sql<{
      count: string;
    }>`SELECT count(*)::text AS count FROM operating_leases
      WHERE career_id = ${founded.careerId}::uuid`.execute(runtime.database);
    expect(invalidCount.rows[0]?.count).toBe("0");
    const outcomes = await Promise.allSettled([
      repository.acceptFounderLease(
        playerId,
        founded.airlineId,
        "founder-atr-72-600",
        "lease-a",
        now,
      ),
      repository.acceptFounderLease(
        playerId,
        founded.airlineId,
        "founder-embraer-e175",
        "lease-b",
        now,
      ),
    ]);
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find(({ status }) => status === "rejected")).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "founder_lease_already_accepted" }),
    });
  });

  it.each(fleetMaterialStages)(
    "rolls back every material acceptance stage at %s",
    async (stage) => {
      const { playerId, founded } = await foundCareer();
      const repository = new KyselyFleetRepository(
        runtime.database,
        (current: FleetMaterialStage) => {
          if (current === stage) throw new Error(`forced fleet rollback at ${stage}`);
        },
      );
      await expect(
        repository.acceptFounderLease(
          playerId,
          founded.airlineId,
          "founder-atr-72-600",
          `rollback-${stage}`,
          now,
        ),
      ).rejects.toThrow(`forced fleet rollback at ${stage}`);
      const counts = await sql<{
        leases: string;
        aircraft: string;
        ownerships: string;
        journals: string;
        outbox: string;
        idempotency: string;
      }>`SELECT
      (SELECT count(*)::text FROM operating_leases WHERE career_id = ${founded.careerId}::uuid) AS leases,
      (SELECT count(*)::text FROM aircraft a JOIN operating_leases l ON l.id = a.operating_lease_id
        WHERE l.career_id = ${founded.careerId}::uuid) AS aircraft,
      (SELECT count(*)::text FROM resource_ownerships WHERE resource_type = 'aircraft'
        AND player_account_id = ${playerId}::uuid) AS ownerships,
      (SELECT count(*)::text FROM journal_entries WHERE description LIKE 'Founder lease%') AS journals,
      (SELECT count(*)::text FROM outbox_events WHERE aggregate_type = 'aircraft') AS outbox,
      (SELECT count(*)::text FROM idempotency_commands WHERE scope = ${`founder-lease:${founded.airlineId}`}) AS idempotency`.execute(
        runtime.database,
      );
      expect(counts.rows[0]).toEqual({
        leases: "0",
        aircraft: "0",
        ownerships: "0",
        journals: "0",
        outbox: "0",
        idempotency: "0",
      });
    },
  );

  it("persists delayed delivery, denies early availability, and delivers exactly at the injected-clock boundary", async () => {
    const { playerId, founded } = await foundCareer();
    const repository = new KyselyFleetRepository(runtime.database);
    const accepted = await repository.acceptFounderLease(
      playerId,
      founded.airlineId,
      "founder-airbus-a320neo",
      "delayed",
      now,
    );
    expect(accepted.aircraft).toMatchObject({
      deliveryState: "pending",
      currentAirportId: null,
      plannedAirportId: accepted.aircraft.plannedAirportId,
      version: "1",
    });
    const target = new Date(accepted.aircraft.deliveryTargetAt);
    expect(target.getTime() - now.getTime()).toBe(12 * 60 * 60 * 1000);
    await expect(
      repository.completeDueDelivery(accepted.aircraft.id, 1n, new Date(target.getTime() - 1)),
    ).rejects.toMatchObject({ code: "aircraft_not_due" });
    const delivered = await repository.completeDueDelivery(accepted.aircraft.id, 1n, target);
    expect(delivered).toMatchObject({
      deliveryState: "delivered",
      currentAirportId: delivered.plannedAirportId,
      deliveredAt: target.toISOString(),
      version: "2",
    });
    expect(await repository.completeDueDelivery(accepted.aircraft.id, 1n, target)).toEqual(
      delivered,
    );
    await expect(repository.completeDueDelivery(accepted.aircraft.id, 2n, target)).resolves.toEqual(
      delivered,
    );
    const events = await sql<{
      event_type: string;
      available_at: Date;
    }>`SELECT event_type, available_at
      FROM outbox_events WHERE aggregate_id = ${accepted.aircraft.id}::uuid ORDER BY event_type`.execute(
      runtime.database,
    );
    expect(events.rows.map(({ event_type }) => event_type)).toEqual([
      "aircraft.delivered.v1",
      "aircraft.delivery_due.v1",
      "aircraft.founder_lease_accepted.v1",
    ]);
    expect(
      events.rows.find(({ event_type }) => event_type === "aircraft.delivery_due.v1")?.available_at,
    ).toEqual(target);
  });

  it("enforces optimistic concurrency and terminal return/default transitions without cash or history mutation", async () => {
    const { playerId, founded } = await foundCareer();
    const repository = new KyselyFleetRepository(runtime.database);
    const accepted = await repository.acceptFounderLease(
      playerId,
      founded.airlineId,
      "founder-embraer-e175",
      "returnable",
      now,
    );
    await expect(
      repository.transitionLease(accepted.lease.id, 99n, "returned", now),
    ).rejects.toMatchObject({ code: "stale_aircraft_version" });
    const returned = await repository.transitionLease(accepted.lease.id, 1n, "returned", now);
    expect(returned).toMatchObject({
      deliveryState: "returned",
      operatorAirlineId: null,
      version: "2",
    });
    expect(await repository.transitionLease(accepted.lease.id, 1n, "returned", now)).toEqual(
      returned,
    );
    await expect(
      repository.transitionLease(accepted.lease.id, 2n, "defaulted", now),
    ).rejects.toMatchObject({ code: "invalid_lease_transition" });
    const terminal = await sql<{
      cash: string;
      active_schedules: string;
      cash_movement: string;
    }>`SELECT
      (SELECT COALESCE(sum(CASE p.side WHEN 'debit' THEN p.reporting_amount_minor ELSE -p.reporting_amount_minor END), 0)::text
        FROM ledger_postings p JOIN ledger_accounts a ON a.id = p.account_id
        WHERE a.code = '1000' AND p.airline_id = ${founded.airlineId}::uuid) AS cash,
      (SELECT count(*)::text FROM operating_lease_payment_schedule WHERE lease_id = ${accepted.lease.id}::uuid
        AND status IN ('scheduled', 'overdue')) AS active_schedules,
      (SELECT details ->> 'cashMovementMinor' FROM aircraft_lifecycle_events
        WHERE aircraft_id = ${accepted.aircraft.id}::uuid AND event_type = 'returned') AS cash_movement`.execute(
      runtime.database,
    );
    expect(terminal.rows[0]).toEqual({
      cash: "55000000",
      active_schedules: "0",
      cash_movement: "0",
    });
    await expect(
      sql`DELETE FROM aircraft_lifecycle_events WHERE aircraft_id = ${accepted.aircraft.id}::uuid`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      sql`UPDATE aircraft SET aircraft_variant_id = ${randomUUID()}::uuid,
      version = version + 1 WHERE id = ${accepted.aircraft.id}::uuid`.execute(runtime.database),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("defaults safely without transferring ownership or producing cash", async () => {
    const { playerId, founded } = await foundCareer();
    const repository = new KyselyFleetRepository(runtime.database);
    const accepted = await repository.acceptFounderLease(
      playerId,
      founded.airlineId,
      "founder-airbus-a320neo",
      "defaulted-lease",
      now,
    );
    const defaulted = await repository.transitionLease(accepted.lease.id, 1n, "defaulted", now);
    expect(defaulted).toMatchObject({
      deliveryState: "defaulted",
      operatorAirlineId: null,
      owner: accepted.aircraft.owner,
      version: "2",
    });
    const state = await sql<{
      status: string;
      cash_movement: string;
      lease_journals: string;
    }>`SELECT
      (SELECT status FROM operating_leases WHERE id = ${accepted.lease.id}::uuid) AS status,
      (SELECT details ->> 'cashMovementMinor' FROM aircraft_lifecycle_events
        WHERE aircraft_id = ${accepted.aircraft.id}::uuid AND event_type = 'defaulted') AS cash_movement,
      (SELECT count(*)::text FROM journal_entries j JOIN ledger_postings p ON p.journal_entry_id = j.id
        WHERE p.contract_id = ${accepted.lease.id}::uuid AND p.line_number = 1) AS lease_journals`.execute(
      runtime.database,
    );
    expect(state.rows[0]).toEqual({ status: "defaulted", cash_movement: "0", lease_journals: "2" });
  });

  it("isolates fleet ownership and retains the accepted catalog snapshot when curated facts later change", async () => {
    const owner = await foundCareer();
    const attacker = await foundCareer();
    const repository = new KyselyFleetRepository(runtime.database);
    const accepted = await repository.acceptFounderLease(
      owner.playerId,
      owner.founded.airlineId,
      "founder-boeing-737-8",
      "owned",
      now,
    );
    expect(await repository.listFleet(attacker.playerId, owner.founded.airlineId, now)).toEqual([]);
    await expect(
      repository.getAircraft(attacker.playerId, accepted.aircraft.id, now),
    ).rejects.toMatchObject({ code: "aircraft_not_found" });
    await sql`UPDATE curated_aircraft_variants SET model = 'Changed future catalog fact'
      WHERE id = ${accepted.aircraft.variantId}::uuid`.execute(runtime.database);
    const retained = await repository.getAircraft(
      owner.playerId,
      accepted.aircraft.id,
      new Date(now.getTime() + 86_400_000),
    );
    expect(retained.model).toBe("737-8");
    expect(retained.chronologicalAgeSeconds).toBe("86400");
    await sql`UPDATE curated_aircraft_variants SET model = '737-8'
      WHERE id = ${accepted.aircraft.variantId}::uuid`.execute(runtime.database);
  });
});
