import { describe, expect, it, vi } from "vitest";
import type { FlightOperationsRepository } from "@airline-manager/domain";
import { FlightMilestoneHandler } from "./operations.js";

describe("flight milestone handler", () => {
  it("passes only routing identity, persisted version, and effective target time to PostgreSQL", async () => {
    const advanceMilestone = vi
      .fn<FlightOperationsRepository["advanceMilestone"]>()
      .mockResolvedValue("applied");
    const now = new Date("2026-07-20T14:00:00Z");
    const handler = new FlightMilestoneHandler(
      { advanceMilestone, status: vi.fn(), settlement: vi.fn() },
      "dispatch",
      () => now,
    );
    const ids = [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000004",
    ];
    const envelope = {
      envelopeVersion: 1 as const,
      commandId: ids[0]!,
      entityId: ids[1]!,
      entityType: "dated_flight",
      expectedVersion: "2",
      correlationId: ids[2]!,
      causationId: ids[3]!,
      targetTime: "2026-07-20T12:00:00.000Z",
      handlerKind: "flight.dispatch",
      handlerVersion: 1,
      routing: { source: "reconciliation" },
    };
    await expect(handler.handle(envelope)).resolves.toEqual({ kind: "applied" });
    expect(advanceMilestone).toHaveBeenCalledWith(
      envelope.entityId,
      "dispatch",
      2n,
      envelope.commandId,
      new Date(envelope.targetTime),
      now,
    );
    expect(JSON.stringify(envelope)).not.toMatch(/revenue|booking|snapshot|money|fuelBurn/);
  });
});
