import { describe, expect, it } from "vitest";
import { acquisitionChannelsForStatus } from "./catalog.js";
import { chronologicalAgeSeconds, createLeasePaymentSchedule } from "./fleet.js";

describe("founder lease domain rules", () => {
  it("creates exact deterministic recurring schedules", () => {
    const schedule = createLeasePaymentSchedule(
      570_000n,
      5,
      6,
      new Date("2026-07-11T12:00:00.000Z"),
    );
    expect(schedule).toHaveLength(6);
    expect(schedule[0]).toEqual({
      paymentNumber: 1,
      dueAt: "2026-07-16T12:00:00.000Z",
      amountMinor: "570000",
      status: "scheduled",
    });
    expect(schedule.at(-1)?.dueAt).toBe("2026-08-10T12:00:00.000Z");
    expect(schedule.every(({ amountMinor }) => amountMinor === "570000")).toBe(true);
  });

  it("advances chronological age exactly one second per real second", () => {
    const manufactured = new Date("2026-07-11T12:00:00.000Z");
    for (const seconds of [0, 1, 60, 86_400, 31_536_000]) {
      expect(
        chronologicalAgeSeconds(
          manufactured,
          0n,
          new Date(manufactured.getTime() + seconds * 1000),
        ),
      ).toBe(BigInt(seconds));
    }
  });

  it("denies factory-new acquisition for discontinued variants unless an explicit scenario overrides it", () => {
    expect(acquisitionChannelsForStatus("discontinued")).toEqual([
      "operating_lease",
      "used_purchase",
    ]);
    expect(acquisitionChannelsForStatus("discontinued")).not.toContain("factory_new");
    expect(acquisitionChannelsForStatus("discontinued", ["factory_new"])).toEqual(["factory_new"]);
  });
});
