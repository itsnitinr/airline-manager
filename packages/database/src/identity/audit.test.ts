import { describe, expect, it, vi } from "vitest";
import { createSecurityAuditWriter } from "./audit.js";

describe("security audit redaction boundary", () => {
  it("rejects credential and session metadata keys before persistence", async () => {
    const database = { insertInto: vi.fn() };
    const writer = createSecurityAuditWriter(database as never);
    await expect(
      writer.record({
        eventType: "authorization.denied",
        targetType: "auth_endpoint",
        targetIdentifier: "/sign-in/email",
        outcome: "denied",
        metadata: { sessionToken: "must-not-persist" },
      }),
    ).rejects.toThrow("metadata key is forbidden");
    expect(database.insertInto).not.toHaveBeenCalled();
  });
});
