import { randomBytes, randomUUID } from "node:crypto";
import { AirlineFoundingService, FleetService, FuelService } from "@airline-manager/application";
import type { FoundingSelectionRequest } from "@airline-manager/contracts";
import {
  KyselyAirlineFoundingRepository,
  KyselyFleetRepository,
  KyselyFuelRepository,
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
    fleetService: new FleetService(
      new KyselyFleetRepository(runtime.database),
      new KyselyIdentityRepository(runtime.database),
      { now: () => new Date("2026-07-11T12:00:00.000Z") },
    ),
    fuelService: new FuelService(
      new KyselyFuelRepository(runtime.database),
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
  const forwardedFor = `198.51.100.${Number.parseInt(randomUUID().slice(0, 2), 16)}`;
  const registered = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: trustedOrigin, "x-forwarded-for": forwardedFor },
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
    headers: { origin: trustedOrigin, "x-forwarded-for": forwardedFor },
  });
  const signedIn = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { origin: trustedOrigin, "x-forwarded-for": forwardedFor },
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
    const attacker = createFixture();
    const attackerCookie = await registerVerifiedSession(attacker.app, attacker.email);
    const founded = await owner.app.inject({
      method: "POST",
      url: "/v1/airlines/founding/confirm",
      headers: { cookie: ownerCookie, "idempotency-key": "owner-founding" },
      payload: { ...selection, airlineName: "Owner Meridian Air" },
    });
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

  it("compares, previews, accepts, and queries the founder fleet through authenticated contracts", async () => {
    const { app, email } = createFixture();
    const cookie = await registerVerifiedSession(app, email);
    const founded = await app.inject({
      method: "POST",
      url: "/v1/airlines/founding/confirm",
      headers: { cookie, "idempotency-key": "fleet-api-founding" },
      payload: { ...selection, airlineName: "Fleet API Meridian" },
    });
    const airlineId = String(founded.json().airlineId);
    const comparison = await app.inject({
      method: "GET",
      url: `/v1/airlines/${airlineId}/founder-package`,
      headers: { cookie },
    });
    expect(comparison.statusCode).toBe(200);
    expect(comparison.json()).toMatchObject({
      packageVersion: "founder-package-v1",
      exactlyOneMayBeAccepted: true,
      options: expect.arrayContaining([
        expect.objectContaining({ code: "founder-atr-72-600", viable: true }),
      ]),
    });
    expect(comparison.json().options).toHaveLength(4);
    const preview = await app.inject({
      method: "POST",
      url: `/v1/airlines/${airlineId}/founder-package/preview`,
      headers: { cookie },
      payload: { optionCode: "founder-atr-72-600" },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      option: { cabin: { economySeats: 72, bookingClassesConfigured: false } },
      nextStep: "accept_founder_lease",
    });
    const input = {
      method: "POST" as const,
      url: `/v1/airlines/${airlineId}/founder-lease/accept`,
      headers: { cookie, "idempotency-key": "fleet-api-accept" },
      payload: { optionCode: "founder-atr-72-600" },
    };
    const accepted = await app.inject(input);
    const repeated = await app.inject(input);
    expect(accepted.statusCode).toBe(201);
    expect(repeated.json()).toEqual(accepted.json());
    expect(accepted.json()).toMatchObject({
      aircraft: { deliveryState: "delivered", variantCode: "atr-72-600" },
      nextStep: "plan_first_route",
    });
    const aircraftId = String(accepted.json().aircraft.id);
    const [fleet, detail, delivery, nextStep] = await Promise.all([
      app.inject({ method: "GET", url: `/v1/airlines/${airlineId}/fleet`, headers: { cookie } }),
      app.inject({
        method: "GET",
        url: `/v1/airlines/${airlineId}/fleet/${aircraftId}`,
        headers: { cookie },
      }),
      app.inject({
        method: "GET",
        url: `/v1/airlines/${airlineId}/fleet/${aircraftId}/delivery-status`,
        headers: { cookie },
      }),
      app.inject({
        method: "GET",
        url: `/v1/airlines/${airlineId}/next-step`,
        headers: { cookie },
      }),
    ]);
    expect(fleet.statusCode).toBe(200);
    expect(fleet.json()).toHaveLength(1);
    expect(detail.json()).toMatchObject({
      id: aircraftId,
      restrictions: { sale: true, collateral: true, cashExtraction: true },
    });
    expect(delivery.json()).toMatchObject({ aircraftId, deliveryState: "delivered" });
    expect(nextStep.json()).toMatchObject({ nextStep: "plan_first_route" });
  });

  it("reports delayed delivery and denies duplicate acceptance and foreign aircraft substitution", async () => {
    const owner = createFixture();
    const ownerCookie = await registerVerifiedSession(owner.app, owner.email);
    const attacker = createFixture();
    const attackerCookie = await registerVerifiedSession(attacker.app, attacker.email);
    const founded = await owner.app.inject({
      method: "POST",
      url: "/v1/airlines/founding/confirm",
      headers: { cookie: ownerCookie, "idempotency-key": "delayed-api-founding" },
      payload: { ...selection, airlineName: "Delayed API Meridian" },
    });
    const airlineId = String(founded.json().airlineId);
    const accepted = await owner.app.inject({
      method: "POST",
      url: `/v1/airlines/${airlineId}/founder-lease/accept`,
      headers: { cookie: ownerCookie, "idempotency-key": "delayed-api-accept" },
      payload: { optionCode: "founder-airbus-a320neo" },
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toMatchObject({
      aircraft: { deliveryState: "pending", currentAirportId: null },
      nextStep: "await_aircraft_delivery",
    });
    const duplicate = await owner.app.inject({
      method: "POST",
      url: `/v1/airlines/${airlineId}/founder-lease/accept`,
      headers: { cookie: ownerCookie, "idempotency-key": "different-api-accept" },
      payload: { optionCode: "founder-boeing-737-8" },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: { code: "founder_lease_already_accepted" } });

    const foreign = await attacker.app.inject({
      method: "GET",
      url: `/v1/airlines/${airlineId}/fleet/${String(accepted.json().aircraft.id)}`,
      headers: { cookie: attackerCookie },
    });
    const missing = await attacker.app.inject({
      method: "GET",
      url: `/v1/airlines/${airlineId}/fleet/${randomUUID()}`,
      headers: { cookie: attackerCookie },
    });
    expect(foreign.statusCode).toBe(403);
    expect(missing.statusCode).toBe(403);
    expect(foreign.body).not.toMatch(/cookie|token|password|SELECT|constraint/i);
  });
});

describe("authenticated global fuel API", () => {
  async function foundApiAirline() {
    const fixture = createFixture();
    const cookie = await registerVerifiedSession(fixture.app, fixture.email);
    const founded = await fixture.app.inject({
      method: "POST",
      url: "/v1/airlines/founding/confirm",
      headers: { cookie, "idempotency-key": `fuel-founding-${randomUUID()}` },
      payload: {
        ...selection,
        airlineName: `Fuel API ${randomUUID().slice(0, 8)}`,
        acceptFoundingLoan: false,
      },
    });
    expect(founded.statusCode).toBe(201);
    return { ...fixture, cookie, airlineId: String(founded.json().airlineId) };
  }

  it("serves prices, quote, purchase, inventory, lots, movements, reserve, forecast, and upgrades", async () => {
    const { app, cookie, airlineId } = await foundApiAirline();
    const prices = await app.inject({
      method: "GET",
      url: `/v1/airlines/${airlineId}/fuel/prices?recentBuckets=2`,
      headers: { cookie },
    });
    expect(prices.statusCode).toBe(200);
    expect(prices.json()).toHaveLength(2);
    const quote = await app.inject({
      method: "POST",
      url: `/v1/airlines/${airlineId}/fuel/quotes`,
      headers: { cookie },
      payload: { quantityKg: "10000" },
    });
    expect(quote.statusCode).toBe(201);
    const purchaseInput = {
      method: "POST" as const,
      url: `/v1/airlines/${airlineId}/fuel/purchases`,
      headers: { cookie, "idempotency-key": "api-fuel-purchase" },
      payload: { quoteId: String(quote.json().id) },
    };
    const purchase = await app.inject(purchaseInput);
    expect(purchase.statusCode).toBe(201);
    expect((await app.inject(purchaseInput)).json()).toEqual(purchase.json());
    const inventory = await app.inject({
      method: "GET",
      url: `/v1/airlines/${airlineId}/fuel/inventory`,
      headers: { cookie },
    });
    expect(inventory.json()).toMatchObject({ onHandKg: "10000", capacityKg: "100000", unit: "kg" });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/airlines/${airlineId}/fuel/lots`,
          headers: { cookie },
        })
      ).json(),
    ).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/airlines/${airlineId}/fuel/movements`,
          headers: { cookie },
        })
      ).json(),
    ).toHaveLength(1);
    const reserve = await app.inject({
      method: "PUT",
      url: `/v1/airlines/${airlineId}/fuel/reserve`,
      headers: { cookie, "idempotency-key": "api-fuel-reserve" },
      payload: { planningReservedKg: "6000" },
    });
    expect(reserve.json()).toMatchObject({ planningReservedKg: "6000", availableKg: "4000" });
    const forecast = await app.inject({
      method: "POST",
      url: `/v1/airlines/${airlineId}/fuel/forecast`,
      headers: { cookie },
      payload: { projectedConsumptionKg: "8000" },
    });
    expect(forecast.json()).toMatchObject({
      projectedOnHandKg: "2000",
      projectedShortageKg: "4000",
      advisoryOnly: true,
    });
    const offers = await app.inject({
      method: "GET",
      url: `/v1/airlines/${airlineId}/fuel/capacity-offers`,
      headers: { cookie },
    });
    expect(offers.json()).toHaveLength(2);
    const upgrade = await app.inject({
      method: "POST",
      url: `/v1/airlines/${airlineId}/fuel/capacity-upgrades`,
      headers: { cookie, "idempotency-key": "api-capacity-upgrade" },
      payload: { tier: 2 },
    });
    expect(upgrade.statusCode).toBe(201);
    expect(upgrade.json()).toMatchObject({ fromTier: 1, toTier: 2, capacityKg: "250000" });
  });

  it("requires ownership, rejects ID substitution, and returns explainable bounded errors", async () => {
    const owner = await foundApiAirline();
    const attacker = await foundApiAirline();
    const foreign = await attacker.app.inject({
      method: "GET",
      url: `/v1/airlines/${owner.airlineId}/fuel/inventory`,
      headers: { cookie: attacker.cookie },
    });
    const missing = await attacker.app.inject({
      method: "GET",
      url: `/v1/airlines/${randomUUID()}/fuel/inventory`,
      headers: { cookie: attacker.cookie },
    });
    expect(foreign.statusCode).toBe(403);
    expect(missing.statusCode).toBe(403);
    expect(foreign.json().error.message).toBe(missing.json().error.message);
    const malformed = await owner.app.inject({
      method: "POST",
      url: `/v1/airlines/${owner.airlineId}/fuel/quotes`,
      headers: { cookie: owner.cookie },
      payload: { quantityKg: "1.5", token: "must-not-echo" },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain("must-not-echo");
    const tooLargeQuote = await owner.app.inject({
      method: "POST",
      url: `/v1/airlines/${owner.airlineId}/fuel/quotes`,
      headers: { cookie: owner.cookie },
      payload: { quantityKg: "100001" },
    });
    const denied = await owner.app.inject({
      method: "POST",
      url: `/v1/airlines/${owner.airlineId}/fuel/purchases`,
      headers: { cookie: owner.cookie, "idempotency-key": "capacity-denial" },
      payload: { quoteId: String(tooLargeQuote.json().id) },
    });
    expect(denied.statusCode).toBe(409);
    expect(denied.json()).toMatchObject({
      error: { code: "fuel_capacity_exceeded", message: expect.stringContaining("capacity") },
    });
    expect(denied.body).not.toMatch(/SELECT|constraint|password|cookie|token/i);
  });
});
