import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  FoundingDomainError,
  createFoundingLoanSchedule,
  type FoundingSelection,
} from "@airline-manager/domain";
import { readDatabasePoolOptions } from "../config.js";
import { seedSliceOneCatalog } from "../catalog/seed.js";
import { createDatabaseRuntime, type DatabaseRuntime } from "../database.js";
import { KyselyLedgerRepository } from "../finance/repository.js";
import {
  KyselyAirlineFoundingRepository,
  foundingMaterialStages,
  type FoundingMaterialStage,
} from "./repository.js";

let runtime: DatabaseRuntime;
const now = new Date("2026-07-11T12:00:00.000Z");

function foundingSelection(overrides: Partial<FoundingSelection> = {}): FoundingSelection {
  return {
    airlineName: `North Star ${randomUUID().slice(0, 8)}`,
    fictionalIdentityConfirmed: true,
    homeJurisdiction: "US",
    principalBaseIataCode: "JFK",
    reportingCurrency: "USD",
    brand: { primaryColor: "#112233", secondaryColor: "#DDEEFF", logoMark: "NS" },
    acceptFoundingLoan: true,
    worldRulesetVersion: "contemporary-2026.07.11",
    ...overrides,
  };
}

async function createPlayer(): Promise<string> {
  const user = await sql<{ id: string }>`INSERT INTO auth_user
    (name, email, "emailVerified")
    VALUES ('Founding Test', ${`founder-${randomUUID()}@example.test`}, true)
    RETURNING id`.execute(runtime.database);
  const player = await sql<{ id: string }>`SELECT id FROM player_accounts
    WHERE authentication_user_id = ${user.rows[0]?.id}::uuid`.execute(runtime.database);
  const playerId = player.rows[0]?.id;
  if (!playerId) throw new Error("Test player was not created.");
  return playerId;
}

async function scopedCounts(playerAccountId: string) {
  const result = await sql<{
    careers: string;
    airlines: string;
    stations: string;
    ownerships: string;
    books: string;
    journals: string;
    loans: string;
    schedules: string;
    outbox: string;
  }>`SELECT
    (SELECT count(*)::text FROM careers WHERE player_account_id = ${playerAccountId}::uuid) AS careers,
    (SELECT count(*)::text FROM airlines a JOIN careers c ON c.id = a.career_id
      WHERE c.player_account_id = ${playerAccountId}::uuid) AS airlines,
    (SELECT count(*)::text FROM airline_stations s JOIN airlines a ON a.id = s.airline_id
      JOIN careers c ON c.id = a.career_id WHERE c.player_account_id = ${playerAccountId}::uuid) AS stations,
    (SELECT count(*)::text FROM resource_ownerships
      WHERE player_account_id = ${playerAccountId}::uuid AND resource_type = 'airline') AS ownerships,
    (SELECT count(*)::text FROM ledger_books b JOIN resource_ownerships o
      ON o.resource_id = b.owner_id AND o.resource_type = 'airline'
      WHERE o.player_account_id = ${playerAccountId}::uuid) AS books,
    (SELECT count(*)::text FROM journal_entries j JOIN ledger_books b ON b.id = j.ledger_book_id
      JOIN resource_ownerships o ON o.resource_id = b.owner_id AND o.resource_type = 'airline'
      WHERE o.player_account_id = ${playerAccountId}::uuid) AS journals,
    (SELECT count(*)::text FROM founding_loans l JOIN airlines a ON a.id = l.airline_id
      JOIN careers c ON c.id = a.career_id WHERE c.player_account_id = ${playerAccountId}::uuid) AS loans,
    (SELECT count(*)::text FROM founding_loan_schedule s JOIN founding_loans l ON l.id = s.loan_id
      JOIN airlines a ON a.id = l.airline_id JOIN careers c ON c.id = a.career_id
      WHERE c.player_account_id = ${playerAccountId}::uuid) AS schedules,
    (SELECT count(*)::text FROM outbox_events e JOIN resource_ownerships o
      ON o.resource_id = e.aggregate_id AND o.resource_type = 'airline'
      WHERE o.player_account_id = ${playerAccountId}::uuid) AS outbox`.execute(runtime.database);
  return result.rows[0];
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

describe("PostgreSQL airline founding", () => {
  it("atomically creates the career, airline, outsourced station, ownership, financing, ledger, and outbox", async () => {
    const playerId = await createPlayer();
    const repository = new KyselyAirlineFoundingRepository(runtime.database);
    await expect(repository.currentSummary(playerId)).resolves.toBeNull();
    const selection = foundingSelection();
    const preview = await repository.preview(playerId, selection, now);
    expect(preview).toMatchObject({
      catalogReleaseVersion: "slice-one-2026.07.11",
      worldRulesetVersion: "contemporary-2026.07.11",
      foundingBalanceVersion: "founding-v1",
      principalBase: { iataCode: "JFK", countryCode: "US", stationServiceModel: "outsourced" },
      nextStep: "select_founder_aircraft",
    });
    expect(preview.runway.assumptions.excludedUntilTicket09).toEqual(
      expect.arrayContaining(["aircraft lease payments", "aircraft fuel", "aircraft maintenance"]),
    );

    const founded = await repository.confirm(playerId, selection, "founding-command-001", now);
    expect(founded).toMatchObject({
      careerStatus: "active",
      nextStep: "select_founder_aircraft",
      financing: { optionalLoan: { selected: true, installmentCount: 6 } },
    });
    const counts = await scopedCounts(playerId);
    expect(counts).toMatchObject({
      careers: "1",
      airlines: "1",
      stations: "1",
      ownerships: "1",
      books: "1",
      journals: "2",
      loans: "1",
      schedules: "6",
      outbox: "1",
    });

    const station = await sql<{
      station_role: string;
      service_model: string;
      facility_investment_minor: string;
    }>`SELECT station_role, service_model, facility_investment_minor
      FROM airline_stations WHERE id = ${founded.stationId}::uuid`.execute(runtime.database);
    expect(station.rows[0]).toEqual({
      station_role: "principal_base",
      service_model: "outsourced",
      facility_investment_minor: "0",
    });

    const summary = await repository.summary(playerId, founded.airlineId);
    expect(summary).toMatchObject({
      cashMinor: "66000000",
      equityMinor: "55000000",
      loanLiabilityMinor: "11000000",
      catalogReleaseVersion: "slice-one-2026.07.11",
      worldRulesetVersion: "contemporary-2026.07.11",
      foundingBalanceVersion: "founding-v1",
    });
    await expect(repository.currentSummary(playerId)).resolves.toEqual(summary);
    const reports = await new KyselyLedgerRepository(runtime.database).reports(
      founded.ledgerBookId,
    );
    expect(reports.cash).toEqual([expect.objectContaining({ reportingAmountMinor: 66_000_000n })]);
    expect(reports.balanceSheet).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "3000", reportingAmountMinor: 55_000_000n }),
        expect.objectContaining({ accountCode: "2200", reportingAmountMinor: 11_000_000n }),
      ]),
    );
    const outbox = await sql<{ event_type: string }>`SELECT event_type FROM outbox_events
      WHERE aggregate_id IN (${founded.airlineId}::uuid, ${founded.ledgerBookId}::uuid)
      ORDER BY event_type`.execute(runtime.database);
    expect(outbox.rows.map(({ event_type }) => event_type)).toEqual([
      "airline.founded.v1",
      "finance.journal_posted.v1",
      "finance.journal_posted.v1",
    ]);

    const persistedSchedule = await sql<{
      installment_number: number;
      due_at: Date;
      principal_minor: string;
      interest_minor: string;
      total_minor: string;
    }>`SELECT s.installment_number, s.due_at, s.principal_minor, s.interest_minor,
      s.total_minor FROM founding_loan_schedule s JOIN founding_loans l ON l.id = s.loan_id
      WHERE l.airline_id = ${founded.airlineId}::uuid ORDER BY s.installment_number`.execute(
      runtime.database,
    );
    const expected = createFoundingLoanSchedule(11_000_000n, 1200, 30, 6, now);
    expect(persistedSchedule.rows).toEqual(
      expected.map((row) => ({
        installment_number: row.installmentNumber,
        due_at: row.dueAt,
        principal_minor: row.principalMinor.toString(),
        interest_minor: row.interestMinor.toString(),
        total_minor: row.totalMinor.toString(),
      })),
    );
  });

  it("declines the optional loan without creating debt or a loan posting", async () => {
    const playerId = await createPlayer();
    const repository = new KyselyAirlineFoundingRepository(runtime.database);
    const founded = await repository.confirm(
      playerId,
      foundingSelection({ acceptFoundingLoan: false }),
      "founding-no-loan",
      now,
    );
    expect(await scopedCounts(playerId)).toMatchObject({
      journals: "1",
      loans: "0",
      schedules: "0",
    });
    expect(await repository.summary(playerId, founded.airlineId)).toMatchObject({
      cashMinor: "55000000",
      equityMinor: "55000000",
      loanLiabilityMinor: "0",
    });
  });

  it("returns the original result for repeated and concurrent identical commands", async () => {
    const playerId = await createPlayer();
    const repository = new KyselyAirlineFoundingRepository(runtime.database);
    const selection = foundingSelection();
    const [left, right] = await Promise.all([
      repository.confirm(playerId, selection, "same-command-key", now),
      repository.confirm(playerId, selection, "same-command-key", now),
    ]);
    expect(right).toEqual(left);
    expect(await repository.confirm(playerId, selection, "same-command-key", now)).toEqual(left);
    expect(await scopedCounts(playerId)).toMatchObject({
      careers: "1",
      airlines: "1",
      ownerships: "1",
      journals: "2",
      loans: "1",
    });
  });

  it("enforces one active slice-one airline in PostgreSQL under concurrent different commands", async () => {
    const playerId = await createPlayer();
    const repository = new KyselyAirlineFoundingRepository(runtime.database);
    const outcomes = await Promise.allSettled([
      repository.confirm(playerId, foundingSelection(), "different-key-a", now),
      repository.confirm(playerId, foundingSelection(), "different-key-b", now),
    ]);
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "active_airline_exists" }),
    });
    expect(await scopedCounts(playerId)).toMatchObject({ careers: "1", airlines: "1" });
  });

  it.each(foundingMaterialStages)(
    "rolls back every material stage failure at %s",
    async (stage) => {
      const playerId = await createPlayer();
      const repository = new KyselyAirlineFoundingRepository(
        runtime.database,
        (current: FoundingMaterialStage) => {
          if (current === stage) throw new Error(`forced rollback at ${stage}`);
        },
      );
      await expect(
        repository.confirm(playerId, foundingSelection(), `rollback-${stage}`, now),
      ).rejects.toThrow(`forced rollback at ${stage}`);
      expect(await scopedCounts(playerId)).toMatchObject({
        careers: "0",
        airlines: "0",
        stations: "0",
        ownerships: "0",
        books: "0",
        journals: "0",
        loans: "0",
        schedules: "0",
        outbox: "0",
      });
    },
  );

  it("isolates ownership and denies foreign airline ID substitution", async () => {
    const ownerId = await createPlayer();
    const attackerId = await createPlayer();
    const repository = new KyselyAirlineFoundingRepository(runtime.database);
    const founded = await repository.confirm(ownerId, foundingSelection(), "owned-airline", now);
    await expect(repository.summary(attackerId, founded.airlineId)).rejects.toMatchObject({
      code: "founding_not_found",
    });
    await expect(repository.summary(ownerId, randomUUID())).rejects.toMatchObject({
      code: "founding_not_found",
    });
  });

  it.each([
    [foundingSelection({ fictionalIdentityConfirmed: false }), "fictional_identity_required"],
    [foundingSelection({ homeJurisdiction: "CA" }), "airport_jurisdiction_mismatch"],
    [foundingSelection({ principalBaseIataCode: "ZZZ" }), "invalid_principal_base"],
    [foundingSelection({ worldRulesetVersion: "missing-ruleset" }), "inactive_world_ruleset"],
  ] as const)(
    "rejects invalid catalog, ruleset, base, or identity input %#",
    async (selection, code) => {
      const repository = new KyselyAirlineFoundingRepository(runtime.database);
      await expect(repository.preview(await createPlayer(), selection, now)).rejects.toMatchObject({
        code,
      });
    },
  );

  it("freezes exact published version bindings and retains account history after airline closure", async () => {
    const playerId = await createPlayer();
    const repository = new KyselyAirlineFoundingRepository(runtime.database);
    const first = await repository.confirm(playerId, foundingSelection(), "first-career", now);
    await expect(
      sql`UPDATE careers SET world_ruleset_id = ${randomUUID()}::uuid
        WHERE id = ${first.careerId}::uuid`.execute(runtime.database),
    ).rejects.toMatchObject({ code: "55000" });

    await sql`UPDATE airlines SET status = 'closed', ended_at = ${now.toISOString()}::timestamptz
      WHERE id = ${first.airlineId}::uuid`.execute(runtime.database);
    await sql`UPDATE careers SET status = 'closed', ended_at = ${now.toISOString()}::timestamptz
      WHERE id = ${first.careerId}::uuid`.execute(runtime.database);
    const replacement = await repository.confirm(
      playerId,
      foundingSelection(),
      "replacement-career",
      new Date("2026-07-12T12:00:00.000Z"),
    );
    expect(replacement.careerId).not.toBe(first.careerId);
    expect(await scopedCounts(playerId)).toMatchObject({
      careers: "2",
      airlines: "2",
      ownerships: "2",
    });
    const account = await sql<{ exists: boolean }>`SELECT EXISTS (
      SELECT 1 FROM player_accounts WHERE id = ${playerId}::uuid) AS exists`.execute(
      runtime.database,
    );
    expect(account.rows[0]?.exists).toBe(true);
  });

  it("rejects idempotency-key reuse with a changed selection", async () => {
    const playerId = await createPlayer();
    const repository = new KyselyAirlineFoundingRepository(runtime.database);
    await repository.confirm(playerId, foundingSelection(), "reused-key", now);
    await expect(
      repository.confirm(
        playerId,
        foundingSelection({ airlineName: "Different Fictional Air" }),
        "reused-key",
        now,
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<FoundingDomainError>>({ code: "idempotency_conflict" }),
    );
  });
});
