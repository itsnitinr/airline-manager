import { describe, expect, it, vi } from "vitest";
import type {
  AirlineFoundingRepository,
  FoundingConfirmation,
  FoundingPreview,
  FoundingSelection,
} from "@airline-manager/domain";
import { AirlineFoundingService } from "./airline.js";

const selection: FoundingSelection = {
  airlineName: "Application Air",
  fictionalIdentityConfirmed: true,
  homeJurisdiction: "US",
  principalBaseIataCode: "JFK",
  reportingCurrency: "USD",
  brand: { primaryColor: "#112233", secondaryColor: "#DDEEFF", logoMark: "AA" },
  acceptFoundingLoan: false,
  worldRulesetVersion: "rules-v1",
};

const authorization = {
  authenticated: true,
  authenticationUserId: "auth-user",
  playerAccountId: "player-account",
  emailVerified: true,
  roles: ["player" as const],
};

describe("airline founding application service", () => {
  it("requires a verified player before invoking founding persistence", async () => {
    const repository = {
      preview: vi.fn(),
      confirm: vi.fn(),
      summary: vi.fn(),
      currentSummary: vi.fn(),
    } satisfies AirlineFoundingRepository;
    const service = new AirlineFoundingService(repository, { ownsResource: vi.fn() });
    expect(() =>
      service.preview(selection, {
        requestId: "request",
        authorization: { authenticated: false, emailVerified: false, roles: [] },
      }),
    ).toThrowError(expect.objectContaining({ code: "authentication_required" }));
    expect(repository.preview).not.toHaveBeenCalled();
  });

  it("passes server-authoritative player ownership and injected time to preview and confirm", async () => {
    const now = new Date("2026-07-11T12:00:00.000Z");
    const preview = vi.fn<AirlineFoundingRepository["preview"]>();
    preview.mockResolvedValue({} as FoundingPreview);
    const confirm = vi.fn<AirlineFoundingRepository["confirm"]>();
    confirm.mockResolvedValue({} as FoundingConfirmation);
    const service = new AirlineFoundingService(
      { preview, confirm, summary: vi.fn(), currentSummary: vi.fn() },
      { ownsResource: vi.fn() },
      { now: () => now },
    );
    await service.preview(selection, { requestId: "preview", authorization });
    await service.confirm(selection, {
      requestId: "confirm",
      commandId: "command",
      transactionId: "transaction",
      idempotencyKey: "founding-key",
      authorization,
    });
    expect(preview).toHaveBeenCalledWith("player-account", selection, now);
    expect(confirm).toHaveBeenCalledWith("player-account", selection, "founding-key", now);
  });

  it("checks opaque airline ownership before reading the summary", async () => {
    const ownsResource = vi.fn(async () => false);
    const summary = vi.fn<AirlineFoundingRepository["summary"]>();
    const service = new AirlineFoundingService(
      { preview: vi.fn(), confirm: vi.fn(), summary, currentSummary: vi.fn() },
      { ownsResource },
    );
    await expect(
      service.summary("foreign-airline", { requestId: "request", authorization }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(ownsResource).toHaveBeenCalledWith("player-account", "airline", "foreign-airline");
    expect(summary).not.toHaveBeenCalled();
  });

  it("queries the verified player's current career without a client-supplied airline id", async () => {
    const currentSummary = vi.fn<AirlineFoundingRepository["currentSummary"]>();
    currentSummary.mockResolvedValue(null);
    const service = new AirlineFoundingService(
      { preview: vi.fn(), confirm: vi.fn(), summary: vi.fn(), currentSummary },
      { ownsResource: vi.fn() },
    );
    await expect(
      service.currentSummary({ requestId: "request", authorization }),
    ).resolves.toBeNull();
    expect(currentSummary).toHaveBeenCalledWith("player-account");
  });
});
