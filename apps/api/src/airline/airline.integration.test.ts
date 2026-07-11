import { randomBytes, randomUUID } from "node:crypto";
import { AirlineFoundingService } from "@airline-manager/application";
import type { FoundingSelectionRequest } from "@airline-manager/contracts";
import {
  KyselyAirlineFoundingRepository,
  KyselyIdentityRepository,
  createDatabaseRuntime,
  readDatabasePoolOptions,
  seedSliceOneCatalog,
  type DatabaseRuntime,
} from "@airline-manager/database";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiServer } from "../app.js";
import { createAuthorizationResolver } from "../auth/authorization.js";
import { createAuthenticationAdapter } from "../auth/better-auth.js";
import { CapturingAuthenticationEmailDelivery } from "../auth/email.js";

const trustedOrigin = "http://localhost:3000";
const password = "correct horse battery staple";
let runtime: DatabaseRuntime;
const apps = new Set<FastifyInstance>();

const selection: FoundingSelectionRequest = {
  airlineName: "Aurora Meridian Air",
  fictionalIdentityConfirmed: true,
  homeJurisdiction: "US",
  principalBaseIataCode: "JFK",
  reportingCurrency: "USD",
  brand: { primaryColor: "#102A43", secondaryColor: "#F6C85F", logoMark: "AM" },
  acceptFoundingLoan: true,
  worldRulesetVersion: "contemporary-2026.07.11",
};

function cookies(response: LightMyRequestResponse): string {
  const values = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"]
    : [response.headers["set-cookie"]];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

function createFixture() {
  const email = new CapturingAuthenticationEmailDelivery();
  const authentication = createAuthenticationAdapter({
    database: runtime.database,
    pool: runtime.pool,
    baseUrl: "http://localhost:3001",
    secret: randomBytes(32).toString("base64url"),
    trustedOrigins: [trustedOrigin],
    secureCookies: false,
    emailDelivery: email,
  });
  const app = createApiServer({
    logger: false,
    corsOrigins: [trustedOrigin],
    authentication: { adapter: authentication, database: runtime.database },
    authorizationResolver: createAuthorizationResolver(authentication, runtime.database),
    airlineFoundingService: new AirlineFoundingService(
      new KyselyAirlineFoundingRepository(runtime.database),
      new KyselyIdentityRepository(runtime.database),
      { now: () => new Date("2026-07-11T12:00:00.000Z") },
    ),
  });
  apps.add(app);
  return { app, email };
}

async function registerVerifiedSession(
  app: FastifyInstance,
  emailDelivery: CapturingAuthenticationEmailDelivery,
): Promise<string> {
  const address = `airline-${randomUUID()}@example.test`;
  const registered = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: trustedOrigin },
    payload: { name: "Airline Founder", email: address, password },
  });
  expect(registered.statusCode).toBe(200);
  const verification = emailDelivery.messages.find(
    (message) => message.kind === "email_verification" && message.to === address,
  );
  const verificationUrl = new URL(verification?.actionUrl ?? "invalid:");
  await app.inject({
    method: "GET",
    url: `${verificationUrl.pathname}${verificationUrl.search}`,
    headers: { origin: trustedOrigin },
  });
  const signedIn = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { origin: trustedOrigin },
    payload: { email: address, password },
  });
  expect(signedIn.statusCode).toBe(200);
  return cookies(signedIn);
}

beforeAll(async () => {
  runtime = createDatabaseRuntime(readDatabasePoolOptions("test"));
  await seedSliceOneCatalog(runtime.database);
});

beforeEach(async () => {
  await Promise.all([...apps].map((app) => app.close()));
  apps.clear();
  await sql`TRUNCATE game_worlds, ledger_books, auth_user, idempotency_commands,
    outbox_events CASCADE`.execute(runtime.database);
});

afterAll(async () => {
  await Promise.all([...apps].map((app) => app.close()));
  await runtime.destroy();
});

describe("authenticated airline founding API", () => {
  it("requires a verified authenticated player for preview and confirmation", async () => {
    const { app } = createFixture();
    const preview = await app.inject({
      method: "POST",
      url: "/v1/airlines/founding/preview",
      payload: selection,
    });
    const confirm = await app.inject({
      method: "POST",
      url: "/v1/airlines/founding/confirm",
      headers: { "idempotency-key": "anonymous-founding" },
      payload: selection,
    });
    expect(preview.statusCode).toBe(401);
    expect(preview.json()).toMatchObject({ error: { code: "authentication_required" } });
    expect(confirm.statusCode).toBe(401);
  });

  it("previews explainable runway, confirms idempotently, and returns owned summary and guidance", async () => {
    const { app, email } = createFixture();
    const cookie = await registerVerifiedSession(app, email);
    const preview = await app.inject({
      method: "POST",
      url: "/v1/airlines/founding/preview",
      headers: { cookie },
      payload: selection,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      catalogReleaseVersion: "slice-one-2026.07.11",
      foundingBalanceVersion: "founding-v1",
      runway: {
        openingCashMinor: "66000000",
        assumptions: {
          excludedUntilTicket09: expect.arrayContaining([
            "aircraft lease payments",
            "aircraft fuel",
          ]),
        },
      },
      nextStep: "select_founder_aircraft",
    });

    const confirmInput = {
      method: "POST" as const,
      url: "/v1/airlines/founding/confirm",
      headers: { cookie, "idempotency-key": "api-founding-command" },
      payload: selection,
    };
    const first = await app.inject(confirmInput);
    const repeated = await app.inject(confirmInput);
    expect(first.statusCode).toBe(201);
    expect(repeated.statusCode).toBe(201);
    expect(repeated.json()).toEqual(first.json());
    const airlineId = String(first.json().airlineId);

    const summary = await app.inject({
      method: "GET",
      url: `/v1/airlines/${airlineId}`,
      headers: { cookie },
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({
      airlineId,
      cashMinor: "66000000",
      equityMinor: "55000000",
      loanLiabilityMinor: "11000000",
      nextStep: "select_founder_aircraft",
    });
    const guidance = await app.inject({
      method: "GET",
      url: `/v1/airlines/${airlineId}/next-step`,
      headers: { cookie },
    });
    expect(guidance.statusCode).toBe(200);
    expect(guidance.json()).toMatchObject({
      nextStep: "select_founder_aircraft",
      nextStepGuidance: expect.stringContaining("No aircraft or lease"),
    });
  });

  it("denies foreign and substituted airline IDs with the same ownership response", async () => {
    const owner = createFixture();
    const ownerCookie = await registerVerifiedSession(owner.app, owner.email);
    const founded = await owner.app.inject({
      method: "POST",
      url: "/v1/airlines/founding/confirm",
      headers: { cookie: ownerCookie, "idempotency-key": "owner-founding" },
      payload: { ...selection, airlineName: "Owner Meridian Air" },
    });
    const attacker = createFixture();
    const attackerCookie = await registerVerifiedSession(attacker.app, attacker.email);
    const foreign = await attacker.app.inject({
      method: "GET",
      url: `/v1/airlines/${String(founded.json().airlineId)}`,
      headers: { cookie: attackerCookie },
    });
    const missing = await attacker.app.inject({
      method: "GET",
      url: `/v1/airlines/${randomUUID()}`,
      headers: { cookie: attackerCookie },
    });
    expect(foreign.statusCode).toBe(403);
    expect(missing.statusCode).toBe(403);
    expect(foreign.json().error).toMatchObject({ code: "forbidden" });
    expect(missing.json().error).toMatchObject({ code: "forbidden" });
    expect(foreign.json().error.message).toBe(missing.json().error.message);
  });

  it("returns bounded validation and domain denials without sensitive or internal data", async () => {
    const { app, email } = createFixture();
    const cookie = await registerVerifiedSession(app, email);
    const malformed = await app.inject({
      method: "POST",
      url: "/v1/airlines/founding/preview",
      headers: { cookie },
      payload: { ...selection, reportingCurrency: "BTC", password: "must-not-echo" },
    });
    const mismatch = await app.inject({
      method: "POST",
      url: "/v1/airlines/founding/preview",
      headers: { cookie },
      payload: { ...selection, homeJurisdiction: "CA" },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain("must-not-echo");
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toMatchObject({
      error: { code: "airport_jurisdiction_mismatch" },
    });
    expect(mismatch.body).not.toMatch(/token|cookie|password|SELECT|constraint/i);
  });
});
