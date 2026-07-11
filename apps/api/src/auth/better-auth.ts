import {
  KyselyIdentityRepository,
  createSecurityAuditWriter,
  type Database,
} from "@airline-manager/database";
import { betterAuth } from "better-auth";
import { PostgresDialect } from "kysely";
import type pg from "pg";
import type { AuthenticationEmailDelivery } from "./email.js";

export type AuthenticationAdapterOptions = Readonly<{
  database: Database;
  pool: pg.Pool;
  baseUrl: string;
  secret: string;
  trustedOrigins: readonly string[];
  secureCookies: boolean;
  emailDelivery: AuthenticationEmailDelivery;
  google?: Readonly<{ clientId: string; clientSecret: string }>;
}>;

export function createAuthenticationAdapter(options: AuthenticationAdapterOptions) {
  const identities = new KyselyIdentityRepository(options.database);
  const audit = createSecurityAuditWriter(options.database);

  const playerFor = async (authenticationUserId: string) =>
    (await identities.findPlayerByAuthenticationUserId(authenticationUserId)) ??
    identities.createPlayerForAuthenticationUser(authenticationUserId);

  return betterAuth({
    appName: "Airline Manager",
    baseURL: options.baseUrl,
    basePath: "/api/auth",
    secret: options.secret,
    database: {
      dialect: new PostgresDialect({ pool: options.pool }),
      type: "postgres",
      casing: "camel",
      transaction: true,
    },
    trustedOrigins: [...options.trustedOrigins],
    user: { modelName: "auth_user" },
    session: {
      modelName: "auth_session",
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      disableSessionRefresh: false,
    },
    account: { modelName: "auth_account" },
    verification: { modelName: "auth_verification" },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60,
      async sendVerificationEmail({ user, url }) {
        void options.emailDelivery
          .send({ kind: "email_verification", to: user.email, actionUrl: url })
          .catch(() => undefined);
      },
      async afterEmailVerification(user) {
        const player = await playerFor(user.id);
        await audit.record({
          eventType: "account.email_verified",
          authenticationUserId: user.id,
          playerAccountId: player.id,
          targetType: "player_account",
          targetIdentifier: player.id,
          outcome: "succeeded",
        });
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }) {
        void options.emailDelivery
          .send({ kind: "password_reset", to: user.email, actionUrl: url })
          .catch(() => undefined);
      },
      async onPasswordReset({ user }) {
        const player = await playerFor(user.id);
        await audit.record({
          eventType: "account.password_reset",
          authenticationUserId: user.id,
          playerAccountId: player.id,
          targetType: "player_account",
          targetIdentifier: player.id,
          outcome: "succeeded",
        });
      },
    },
    socialProviders: options.google
      ? { google: { clientId: options.google.clientId, clientSecret: options.google.clientSecret } }
      : {},
    rateLimit: {
      enabled: true,
      storage: "memory",
      window: 60,
      max: 100,
      customRules: {
        "/sign-up/email": { window: 60, max: 5 },
        "/sign-in/email": { window: 60, max: 10 },
        "/send-verification-email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 5 },
        "/reset-password": { window: 60, max: 5 },
      },
    },
    advanced: {
      database: { generateId: "uuid" },
      cookiePrefix: "airline-manager",
      useSecureCookies: options.secureCookies,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: options.secureCookies,
        sameSite: "lax",
        path: "/",
      },
      disableCSRFCheck: false,
      disableOriginCheck: false,
    },
    databaseHooks: {
      user: {
        create: {
          async after(user) {
            const player = await playerFor(user.id);
            await audit.record({
              eventType: "account.registered",
              authenticationUserId: user.id,
              playerAccountId: player.id,
              targetType: "player_account",
              targetIdentifier: player.id,
              outcome: "succeeded",
            });
          },
        },
      },
      session: {
        create: {
          async after(session) {
            const player = await playerFor(session.userId);
            await audit.record({
              eventType: "session.created",
              authenticationUserId: session.userId,
              playerAccountId: player.id,
              targetType: "player_account",
              targetIdentifier: player.id,
              outcome: "succeeded",
            });
          },
        },
        delete: {
          async after(session) {
            const player = await identities.findPlayerByAuthenticationUserId(session.userId);
            await audit.record({
              eventType: "session.revoked",
              authenticationUserId: session.userId,
              ...(player ? { playerAccountId: player.id } : {}),
              targetType: "player_account",
              targetIdentifier: player?.id ?? session.userId,
              outcome: "succeeded",
            });
          },
        },
      },
    },
    logger: { disabled: true },
  });
}

export type AuthenticationAdapter = ReturnType<typeof createAuthenticationAdapter>;
