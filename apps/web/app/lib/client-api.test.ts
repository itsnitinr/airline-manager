import { afterEach, describe, expect, it, vi } from "vitest";
import { authApi, createStableIdempotencyKey, mapApiError } from "./client-api";

describe("web API boundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps standard envelopes to field errors without exposing backend text", () => {
    expect(
      mapApiError(400, {
        error: {
          code: "validation_error",
          message: "raw adapter text",
          requestId: "request",
          details: [{ field: "/airlineName", issue: "must have at least 3 characters" }],
        },
      }),
    ).toEqual({
      code: "validation_error",
      fields: { airlineName: "must have at least 3 characters" },
      details: [{ field: "airlineName", issue: "must have at least 3 characters" }],
      message: "Review the highlighted information and try again.",
      recoverable: false,
    });
  });

  it("reuses an idempotency key for the same request and rotates it when input changes", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    const first = createStableIdempotencyKey("founding", "selection-a", storage);
    const repeated = createStableIdempotencyKey("founding", "selection-a", storage);
    const changed = createStableIdempotencyKey("founding", "selection-b", storage);
    expect(repeated).toBe(first);
    expect(changed).not.toBe(first);
  });

  it("initiates Google sign-in through the same-origin auth boundary", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ url: "https://accounts.google.test/authorize", redirect: false }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await authApi.google({
      callbackURL: "http://localhost:3000/onboarding",
      errorCallbackURL: "http://localhost:3000/sign-in?provider=google",
    });

    expect(fetch).toHaveBeenCalledWith(
      "/backend/api/auth/sign-in/social",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"provider":"google"'),
      }),
    );
  });
});
