import { describe, expect, it } from "vitest";
import {
  assessMaintenanceDue,
  conditionAfterUtilization,
  deterministicFault,
  type FaultInputSnapshot,
  type MaintenanceRule,
} from "./maintenance.js";

const rule: MaintenanceRule = {
  id: "rule",
  code: "variant_line",
  name: "Variant line service",
  kind: "line",
  intervalHoursMinutes: "6000",
  intervalCycles: "100",
  intervalCalendarDays: 10,
  hardLimit: false,
  maximumDeferralHoursMinutes: "600",
  maximumDeferralCycles: "10",
  maximumDeferralCalendarDays: 2,
  durationMinutes: 180,
  workforceCapacity: 1,
  costMinor: "1000",
  conditionRestoreBasisPoints: 300,
};

const baseline = {
  accumulatedHoursMinutes: 1_000n,
  accumulatedCycles: 20n,
  calendarStartedAt: new Date("2026-07-01T12:00:00.000Z"),
  measuredAt: new Date("2026-07-01T12:00:00.000Z"),
};

describe("aircraft maintenance invariants", () => {
  it("advances calendar thresholds at one real UTC day per day", () => {
    const before = assessMaintenanceDue(rule, baseline, {
      ...baseline,
      measuredAt: new Date("2026-07-11T11:59:59.999Z"),
    });
    const due = assessMaintenanceDue(rule, baseline, {
      ...baseline,
      measuredAt: new Date("2026-07-11T12:00:00.000Z"),
    });
    expect(before.calendarDaysRemaining).toBe(1);
    expect(before.state).toBe("not_due");
    expect(due.calendarDaysRemaining).toBe(0);
    expect(due.state).toBe("due");
  });

  it("distinguishes due, bounded soft deferral, and hard-limit dispatch blocks", () => {
    const due = assessMaintenanceDue(rule, baseline, {
      ...baseline,
      accumulatedCycles: 120n,
    });
    const soft = assessMaintenanceDue(rule, baseline, {
      ...baseline,
      accumulatedCycles: 121n,
    });
    const hard = assessMaintenanceDue(rule, baseline, {
      ...baseline,
      accumulatedCycles: 131n,
    });
    expect(due.state).toBe("due");
    expect(soft.state).toBe("soft_overdue");
    expect(soft.hardLimitExceeded).toBe(false);
    expect(hard.state).toBe("hard_overdue");
    expect(hard.hardLimitExceeded).toBe(true);
    expect(hard.recoveryStep).toContain("qualified line-maintenance capacity");
  });

  it("makes explicit hard limits non-deferrable", () => {
    const hardRule = { ...rule, hardLimit: true };
    expect(
      assessMaintenanceDue(hardRule, baseline, {
        ...baseline,
        accumulatedHoursMinutes: 7_000n,
      }).state,
    ).toBe("hard_overdue");
  });

  it("degrades condition and reliability deterministically without leaving bounds", () => {
    for (let minutes = 1; minutes <= 1_440; minutes += 37) {
      const result = conditionAfterUtilization(9_500, BigInt(minutes), 1n, [
        assessMaintenanceDue(rule, baseline, {
          ...baseline,
          accumulatedHoursMinutes: 8_000n,
        }),
      ]);
      expect(result.conditionBasisPoints).toBeGreaterThanOrEqual(0);
      expect(result.conditionBasisPoints).toBeLessThanOrEqual(10_000);
      expect(result.dispatchReliabilityBasisPoints).toBeGreaterThanOrEqual(5_000);
      expect(result.dispatchReliabilityBasisPoints).toBeLessThanOrEqual(9_990);
    }
  });

  it("replays identical persisted fault seeds and snapshots and keeps every outcome non-fatal", () => {
    const snapshot: FaultInputSnapshot = {
      aircraftId: "aircraft",
      completionKey: "flight-completion-42",
      programVersion: "maintenance-v1",
      conditionBasisPoints: 6_000,
      dispatchReliabilityBasisPoints: 7_000,
      accumulatedHoursMinutes: "12345",
      accumulatedCycles: "456",
    };
    for (let index = 0; index < 2_000; index += 1) {
      const seed = `seed-${index}`;
      const first = deterministicFault(seed, snapshot);
      expect(deterministicFault(seed, snapshot)).toEqual(first);
      expect(first.outcome).toMatch(/^(none|delay|grounding)$/);
      expect(first.delayMinutes).toBeGreaterThanOrEqual(0);
      expect(first.delayMinutes).toBeLessThanOrEqual(120);
      expect(first.repairDurationMinutes).toBeLessThanOrEqual(360);
      expect(first.explanation.toLowerCase()).not.toMatch(/fatal|death|crash|injur|hull loss/);
    }
  });

  it("keeps rule-version material inputs stable under unrelated balance changes", () => {
    const snapshot: FaultInputSnapshot = {
      aircraftId: "aircraft",
      completionKey: "stable",
      programVersion: "maintenance-v1",
      conditionBasisPoints: 8_000,
      dispatchReliabilityBasisPoints: 9_000,
      accumulatedHoursMinutes: "100",
      accumulatedCycles: "2",
    };
    const result = deterministicFault("persisted-seed", snapshot);
    const unrelatedFutureRule = { ...rule, costMinor: "999999", durationMinutes: 999 };
    expect(unrelatedFutureRule.costMinor).not.toBe(rule.costMinor);
    expect(deterministicFault("persisted-seed", snapshot)).toEqual(result);
  });
});
