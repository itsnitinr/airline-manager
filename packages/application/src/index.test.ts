import { describe, expect, it } from "vitest";
import {
  anonymousAuthorizationContext,
  createApplicationServices,
  type CommandContext,
} from "./index.js";

describe("application service boundaries", () => {
  it("executes a command without an HTTP framework", async () => {
    const context: CommandContext = {
      requestId: "request-1",
      commandId: "command-1",
      transactionId: "transaction-1",
      idempotencyKey: "retry-safe-1",
      authorization: anonymousAuthorizationContext,
    };
    const services = createApplicationServices({ now: () => new Date("2026-07-11T12:00:00Z") });

    await expect(
      services.sampleCommand.execute({ message: "worker invocation" }, context),
    ).resolves.toEqual({
      message: "worker invocation",
      commandId: "command-1",
      transactionId: "transaction-1",
      executedAt: "2026-07-11T12:00:00.000Z",
    });
  });
});
