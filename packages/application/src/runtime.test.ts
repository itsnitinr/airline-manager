import { describe, expect, it, vi } from "vitest";
import {
  DrainCoordinator,
  InvalidEnvelopeError,
  UnsupportedEnvelopeError,
  VersionedHandlerRegistry,
  authorizeReplay,
  classifyJobError,
  deterministicJobId,
  parseJobEnvelope,
  redactDiagnostic,
  retryBackoffMilliseconds,
} from "./runtime.js";

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    envelopeVersion: 1,
    commandId: "11111111-1111-4111-8111-111111111111",
    entityId: "22222222-2222-4222-8222-222222222222",
    entityType: "aircraft",
    expectedVersion: "2",
    correlationId: "33333333-3333-4333-8333-333333333333",
    causationId: "44444444-4444-4444-8444-444444444444",
    targetTime: "2026-07-12T12:00:00.000Z",
    handlerKind: "aircraft.delivery",
    handlerVersion: 1,
    routing: { source: "outbox" },
    ...overrides,
  };
}

describe("background runtime contracts", () => {
  it("validates versions and rejects authoritative or secret routing data", () => {
    expect(() => parseJobEnvelope(envelope({ envelopeVersion: 2 }))).toThrow(
      UnsupportedEnvelopeError,
    );
    expect(() => parseJobEnvelope(envelope({ routing: { cashBalance: "100" } }))).toThrow(
      InvalidEnvelopeError,
    );
    expect(() => parseJobEnvelope(envelope({ authoritativeMoneyTotal: "100" }))).toThrow(
      InvalidEnvelopeError,
    );
    expect(() => parseJobEnvelope(envelope({ routing: { source: "Bearer private" } }))).toThrow(
      InvalidEnvelopeError,
    );
    expect(parseJobEnvelope(envelope()).routing).toEqual({ source: "outbox" });
  });

  it("derives stable transport identity without payload data", () => {
    const parsed = parseJobEnvelope(envelope());
    expect(deterministicJobId(parsed)).toBe(
      deterministicJobId({ ...parsed, routing: { source: "replay" } }),
    );
  });

  it("redacts nested diagnostics and classifies bounded retries", () => {
    expect(redactDiagnostic({ token: "x", nested: { passengerData: "x", safe: "ok" } })).toEqual({
      token: "[REDACTED]",
      nested: { passengerData: "[REDACTED]", safe: "ok" },
    });
    expect(classifyJobError(new InvalidEnvelopeError("bad"))).toBe("permanent");
    expect(retryBackoffMilliseconds(1)).toBe(1_000);
    expect(retryBackoffMilliseconds(20)).toBe(60_000);
  });

  it("dispatches versions and makes premature work a no-op", async () => {
    const handler = vi.fn(async () => ({ kind: "applied" as const }));
    const registry = new VersionedHandlerRegistry();
    registry.register("aircraft.delivery", 1, handler);
    const parsed = parseJobEnvelope(envelope());
    await expect(registry.dispatch(parsed, new Date("2026-07-12T11:59:00Z"))).resolves.toEqual({
      kind: "premature",
    });
    await expect(registry.dispatch(parsed, new Date("2026-07-12T12:00:00Z"))).resolves.toEqual({
      kind: "applied",
    });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("stops intake and reports bounded drain completion", async () => {
    const drain = new DrainCoordinator();
    const finish = drain.tryStart();
    expect(finish).toBeTypeOf("function");
    const result = drain.drain(100);
    expect(drain.tryStart()).toBeUndefined();
    finish?.();
    await expect(result).resolves.toBe(true);
  });

  it("requires attributed administrator replay", () => {
    expect(() =>
      authorizeReplay({
        actorIdentifier: "ops",
        isAdministrator: false,
        reason: "investigate retry",
        requestId: "55555555-5555-4555-8555-555555555555",
      }),
    ).toThrow();
    expect(() =>
      authorizeReplay({
        actorIdentifier: "ops",
        isAdministrator: true,
        reason: "investigate retry",
        requestId: "55555555-5555-4555-8555-555555555555",
      }),
    ).not.toThrow();
  });
});
