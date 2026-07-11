import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api-client.js";

describe("OpenAPI-typed web client", () => {
  it("sends the generated command body and idempotency header", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "typed",
          commandId: "command-id",
          transactionId: "transaction-id",
          executedAt: "2026-07-11T12:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = createApiClient({ baseUrl: "https://api.example", fetch: fetchImplementation });

    await expect(
      client.executeSampleCommand({
        body: { message: "typed" },
        headers: { "idempotency-key": "typed-key-123" },
      }),
    ).resolves.toMatchObject({ message: "typed" });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.example/v1/system/commands/sample",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "idempotency-key": "typed-key-123" }),
      }),
    );
  });

  it("builds a reconnectable event URL from the generated cursor contract", () => {
    const client = createApiClient({ baseUrl: "https://api.example/" });
    expect(client.eventsUrl({ query: { cursor: "event-42" } })).toBe(
      "https://api.example/v1/events?cursor=event-42",
    );
  });
});
