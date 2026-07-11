import { randomBytes, randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { requireOwnedResource } from "@airline-manager/application";
import {
  KyselyIdentityRepository,
  createDatabaseRuntime,
  readDatabasePoolOptions,
  setPlayerRole,
  type DatabaseRuntime,
} from "@airline-manager/database";
import type { FastifyInstance, FastifyServerOptions, LightMyRequestResponse } from "fastify";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiServer } from "../app.js";
import { createAuthorizationResolver } from "./authorization.js";
import { createAuthenticationAdapter } from "./better-auth.js";
import { CapturingAuthenticationEmailDelivery } from "./email.js";

const trustedOrigin = "http://localhost:3000";
const password = "correct horse battery staple";
let runtime: DatabaseRuntime;
const apps = new Set<FastifyInstance>();

function responseCookies(response: LightMyRequestResponse): string {
  const values = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"]
    : [response.headers["set-cookie"]];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

function createFixture(
  options: {
    secureCookies?: boolean;
    google?: boolean;
    logger?: FastifyServerOptions["logger"];
  } = {},
) {
  const email = new CapturingAuthenticationEmailDelivery();
  const auth = createAuthenticationAdapter({
    database: runtime.database,
    pool: runtime.pool,
    baseUrl: "http://localhost:3001",
    secret: randomBytes(32).toString("base64url"),
    trustedOrigins: [trustedOrigin],
    secureCookies: options.secureCookies ?? false,
    emailDelivery: email,
    ...(options.google
      ? { google: { clientId: "fake-google-client", clientSecret: "fake-google-secret" } }
      : {}),
  });
  const app = createApiServer({
    logger: options.logger ?? false,
    corsOrigins: [trustedOrigin],
    authentication: { adapter: auth, database: runtime.database },
    authorizationResolver: createAuthorizationResolver(auth, runtime.database),
  });
  app.get("/_test/authorization", async (request) => request.authorizationContext);
  apps.add(app);
  return { app, auth, email };
}

async function registerAndVerify(
  app: FastifyInstance,
  emailDelivery: CapturingAuthenticationEmailDelivery,
) {
  const emailAddress = `player-${randomUUID()}@example.test`;
  const registration = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: trustedOrigin },
    payload: { name: "Test Player", email: emailAddress, password },
  });
  expect(registration.statusCode).toBe(200);
  expect(registration.body).not.toMatch(/password|token/i);
  const verification = emailDelivery.messages.find(
    (message) => message.kind === "email_verification",
  );
  expect(verification?.to).toBe(emailAddress);
  const verificationUrl = new URL(verification?.actionUrl ?? "invalid:");
  const verified = await app.inject({
    method: "GET",
    url: `${verificationUrl.pathname}${verificationUrl.search}`,
    headers: { origin: trustedOrigin },
  });
  expect([200, 302]).toContain(verified.statusCode);
  return emailAddress;
}

async function signIn(app: FastifyInstance, email: string, nextPassword = password) {
  return app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { origin: trustedOrigin },
    payload: { email, password: nextPassword },
  });
}

beforeAll(() => {
  runtime = createDatabaseRuntime(readDatabasePoolOptions("test"));
});

beforeEach(async () => {
  await Promise.all([...apps].map((app) => app.close()));
  apps.clear();
  await sql`TRUNCATE security_audit_events, resource_ownerships, auth_user CASCADE`.execute(
    runtime.database,
  );
});

afterAll(async () => {
  await Promise.all([...apps].map((app) => app.close()));
  await runtime.destroy();
});

describe("Better Auth and domain identity integration", () => {
  it("registers a distinct player, requires verification, signs in, and signs out securely", async () => {
    const { app, email } = createFixture();
    const emailAddress = `player-${randomUUID()}@example.test`;
    const registration = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { origin: trustedOrigin },
      payload: { name: "Test Player", email: emailAddress, password },
    });
    expect(registration.statusCode).toBe(200);

    const authUser = await runtime.database
      .selectFrom("auth_user")
      .select(["id", "emailVerified"])
      .where("email", "=", emailAddress)
      .executeTakeFirstOrThrow();
    const player = await runtime.database
      .selectFrom("player_accounts")
      .selectAll()
      .where("authentication_user_id", "=", authUser.id)
      .executeTakeFirstOrThrow();
    expect(player.id).not.toBe(authUser.id);
    await expect(
      new KyselyIdentityRepository(runtime.database).findRoles(player.id),
    ).resolves.toEqual(["player"]);

    const unverified = await signIn(app, emailAddress);
    expect(unverified.statusCode).toBe(403);
    const verificationUrl = new URL(email.messages[0]?.actionUrl ?? "invalid:");
    await app.inject({
      method: "GET",
      url: `${verificationUrl.pathname}${verificationUrl.search}`,
    });

    const signedIn = await signIn(app, emailAddress);
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.body).not.toMatch(/"token"|password|fake-google-secret/i);
    const setCookie = String(signedIn.headers["set-cookie"]);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/; Secure/i);
    const cookie = responseCookies(signedIn);
    const rollingExpiryBefore = new Date(Date.now() + 60 * 60 * 1000);
    await runtime.database
      .updateTable("auth_session")
      .set({
        updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        expiresAt: rollingExpiryBefore,
      })
      .execute();

    const context = await app.inject({
      method: "GET",
      url: "/_test/authorization",
      headers: { cookie },
    });
    expect(context.json()).toMatchObject({
      authenticated: true,
      authenticationUserId: authUser.id,
      playerAccountId: player.id,
      emailVerified: true,
      roles: ["player"],
    });
    const refreshedSession = await runtime.database
      .selectFrom("auth_session")
      .select(["id", "expiresAt"])
      .executeTakeFirstOrThrow();
    expect(refreshedSession.expiresAt.getTime()).toBeGreaterThan(rollingExpiryBefore.getTime());
    const publicSession = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { cookie },
    });
    expect(publicSession.body).not.toContain("token");
    expect(publicSession.body).not.toContain(refreshedSession.id);

    const signedOut = await app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: { origin: trustedOrigin, cookie },
    });
    expect(signedOut.statusCode).toBe(200);
    const sessions = await runtime.database
      .selectFrom("auth_session")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow();
    expect(Number(sessions.count)).toBe(0);
    const eventTypes = await runtime.database
      .selectFrom("security_audit_events")
      .select("event_type")
      .execute();
    expect(eventTypes.map(({ event_type }) => event_type)).toEqual(
      expect.arrayContaining(["session.created", "session.revoked"]),
    );
  });

  it("captures recovery email deterministically, resets the password, and revokes sessions", async () => {
    const { app, email } = createFixture();
    const emailAddress = await registerAndVerify(app, email);
    const signedIn = await signIn(app, emailAddress);
    const oldCookie = responseCookies(signedIn);

    const requested = await app.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      headers: { origin: trustedOrigin },
      payload: { email: emailAddress, redirectTo: `${trustedOrigin}/recover` },
    });
    expect(requested.statusCode).toBe(200);
    const recovery = email.messages.find((message) => message.kind === "password_reset");
    const recoveryUrl = new URL(recovery?.actionUrl ?? "invalid:");
    const resetToken =
      recoveryUrl.searchParams.get("token") ?? recoveryUrl.pathname.split("/").at(-1);
    expect(resetToken).toBeTruthy();
    const newPassword = "a different secure passphrase";
    const reset = await app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      headers: { origin: trustedOrigin },
      payload: { newPassword, token: resetToken },
    });
    expect(reset.statusCode).toBe(200);
    expect((await signIn(app, emailAddress)).statusCode).toBe(401);
    expect((await signIn(app, emailAddress, newPassword)).statusCode).toBe(200);

    const expiredOldSession = await app.inject({
      method: "GET",
      url: "/_test/authorization",
      headers: { cookie: oldCookie },
    });
    expect(expiredOldSession.json()).toMatchObject({ authenticated: false });
  });

  it("fails expired sessions safely and enforces trusted origins, CORS, and secure cookies", async () => {
    const { app, email } = createFixture({ secureCookies: true });
    const emailAddress = await registerAndVerify(app, email);
    const signedIn = await signIn(app, emailAddress);
    expect(String(signedIn.headers["set-cookie"])).toMatch(/; Secure/i);
    const cookie = responseCookies(signedIn);
    await runtime.database
      .updateTable("auth_session")
      .set({ expiresAt: new Date("2000-01-01T00:00:00Z") })
      .execute();
    const expired = await app.inject({
      method: "GET",
      url: "/_test/authorization",
      headers: { cookie },
    });
    expect(expired.json()).toMatchObject({ authenticated: false, emailVerified: false });

    const rejected = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: "https://attacker.example" },
      payload: { email: emailAddress, password },
    });
    expect(rejected.statusCode).toBe(403);
    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/auth/sign-in/email",
      headers: { origin: trustedOrigin, "access-control-request-method": "POST" },
    });
    expect(preflight.headers["access-control-allow-origin"]).toBe(trustedOrigin);
    expect(signedIn.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("rate-limits recovery endpoints and configures Google without contacting OAuth", async () => {
    const { app } = createFixture({ google: true });
    const address = `missing-${randomUUID()}@example.test`;
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/request-password-reset",
        headers: { origin: trustedOrigin },
        payload: { email: address, redirectTo: `${trustedOrigin}/recover` },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses.slice(0, 4)).toEqual([200, 200, 200, 200]);
    expect(statuses).toContain(429);

    const google = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/social",
      headers: { origin: trustedOrigin },
      payload: { provider: "google", callbackURL: trustedOrigin },
    });
    expect(google.statusCode).toBe(200);
    expect(google.json().url).toContain("accounts.google.com");
    expect(google.body).not.toContain("fake-google-secret");
  });

  it("persists server roles and prevents cross-account ownership substitution and query leakage", async () => {
    const firstAuthUserId = randomUUID();
    const secondAuthUserId = randomUUID();
    await runtime.database
      .insertInto("auth_user")
      .values([
        {
          id: firstAuthUserId,
          name: "One",
          email: `${firstAuthUserId}@example.test`,
          emailVerified: true,
        },
        {
          id: secondAuthUserId,
          name: "Two",
          email: `${secondAuthUserId}@example.test`,
          emailVerified: true,
        },
      ])
      .execute();
    const identities = new KyselyIdentityRepository(runtime.database);
    const first = await identities.findPlayerByAuthenticationUserId(firstAuthUserId);
    const second = await identities.findPlayerByAuthenticationUserId(secondAuthUserId);
    if (!first || !second) throw new Error("Expected trigger-created players.");
    const firstResource = randomUUID();
    const secondResource = randomUUID();
    await identities.bindResourceOwnership({
      playerAccountId: first.id,
      resourceType: "airline",
      resourceId: firstResource,
    });
    await identities.bindResourceOwnership({
      playerAccountId: second.id,
      resourceType: "airline",
      resourceId: secondResource,
    });
    const firstContext = {
      authenticated: true as const,
      authenticationUserId: firstAuthUserId,
      playerAccountId: first.id,
      emailVerified: true,
      roles: ["player" as const],
    };
    await expect(
      requireOwnedResource(identities, firstContext, "airline", secondResource),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      requireOwnedResource(identities, firstContext, "airline", randomUUID()),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(identities.listOwnedResourceIds(first.id, "airline")).resolves.toEqual([
      firstResource,
    ]);

    await setPlayerRole(runtime.database, {
      actorPlayerAccountId: first.id,
      targetPlayerAccountId: second.id,
      role: "administrator",
      granted: true,
      requestId: "role-test",
    });
    await expect(identities.findRoles(second.id)).resolves.toEqual(["administrator", "player"]);
  });

  it("rolls back player creation with auth identity and keeps audits immutable and secret-free", async () => {
    const authenticationUserId = randomUUID();
    await expect(
      runtime.database.transaction().execute(async (transaction) => {
        await transaction
          .insertInto("auth_user")
          .values({
            id: authenticationUserId,
            name: "Rollback",
            email: `${authenticationUserId}@example.test`,
            emailVerified: false,
          })
          .execute();
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(
      await runtime.database
        .selectFrom("player_accounts")
        .select("id")
        .where("authentication_user_id", "=", authenticationUserId)
        .executeTakeFirst(),
    ).toBeUndefined();

    const { app, email } = createFixture();
    await registerAndVerify(app, email);
    const events = await runtime.database.selectFrom("security_audit_events").selectAll().execute();
    expect(events.map(({ event_type }) => event_type)).toEqual(
      expect.arrayContaining(["account.registered", "account.email_verified"]),
    );
    expect(JSON.stringify(events)).not.toContain(password);
    expect(JSON.stringify(events)).not.toMatch(/token|session/i);
    await expect(
      runtime.database.updateTable("security_audit_events").set({ outcome: "failed" }).execute(),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("keeps auth credentials, tokens, cookies, and provider secrets out of logs and errors", async () => {
    let logs = "";
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        logs += chunk.toString();
        callback();
      },
    });
    const { app, email } = createFixture({
      google: true,
      logger: { level: "info", stream },
    });
    const emailAddress = await registerAndVerify(app, email);
    const signedIn = await signIn(app, emailAddress);
    const cookie = responseCookies(signedIn);
    await app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: { origin: trustedOrigin, cookie, authorization: "Bearer private-credential" },
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: trustedOrigin },
      payload: { email: emailAddress, password: "incorrect-private-password" },
    });
    expect(invalid.body).not.toContain("incorrect-private-password");
    expect(logs).not.toContain(password);
    expect(logs).not.toContain("incorrect-private-password");
    expect(logs).not.toContain("private-credential");
    expect(logs).not.toContain("fake-google-secret");
    expect(logs).not.toContain(cookie);
    for (const message of email.messages) {
      expect(logs).not.toContain(message.actionUrl);
      const secretValue =
        new URL(message.actionUrl).searchParams.get("token") ??
        new URL(message.actionUrl).pathname.split("/").at(-1);
      if (secretValue) expect(logs).not.toContain(secretValue);
    }
  });
});
