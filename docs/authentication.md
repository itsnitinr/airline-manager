# Authentication and ownership

Better Auth `1.6.23` is the authentication adapter. It owns credential hashes, Google OAuth
accounts and provider tokens, verification/reset values, and PostgreSQL-backed sessions in the
clearly isolated `auth_*` tables. The application never invokes Better Auth's migration command.
The checked-in `0003_authentication_and_ownership.sql` migration was reviewed from Better Auth's
generated PostgreSQL schema and is applied only by the repository migration runner.

The domain identity is a separate `player_accounts` row linked by the Better Auth user UUID. The
database creates that row and its ordinary `player` role in the same transaction as the auth user.
Roles are loaded from `player_account_roles` for every authorization context; browser session or
request claims cannot grant player or administrator capability. Administrative role changes use a
transactional persistence operation that appends a `security_audit_events` record.

## Local setup

Generate an uncommitted local cookie-signing secret and put it in `.env`:

```sh
cp .env.example .env
openssl rand -base64 32
```

Assign the output to `BETTER_AUTH_SECRET`. `.env` is ignored. Do not reuse the value outside that
local environment. `BETTER_AUTH_URL` is the externally visible API origin. `API_CORS_ORIGINS` is a
comma-separated allowlist and is also the Better Auth trusted-origin allowlist. Local HTTP uses
`AUTH_COOKIE_SECURE=false`; every HTTPS deployment must use `true`.

Google is disabled unless both `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are set at
runtime. Configure the provider callback as `${BETTER_AUTH_URL}/api/auth/callback/google`. A partial
Google configuration fails startup. No provider credential belongs in an example, image, log, or
repository file.

Authentication email uses the provider-neutral `AuthenticationEmailDelivery` interface. The local
and test composition captures verification and recovery links deterministically in process memory;
it never logs them or calls a live provider. A production composition must inject an implementation
backed by its deployment's transactional email provider. This interface is authentication-only and
does not select or implement gameplay email notifications.

## Security behavior

- Email/password accounts require verification before a session is issued. Passwords are 12 to 128
  characters and use Better Auth's password hasher.
- Verification and reset values expire after one hour. Password reset revokes every existing
  session.
- Sessions expire after seven days and roll their database/cookie expiry after one day of age.
  Sign-out deletes the persisted session.
- Session cookies are signed, HTTP-only, `SameSite=Lax`, scoped to `/`, and secure in HTTPS
  deployments. Cross-subdomain cookies are not enabled.
- Better Auth origin, redirect, Fetch Metadata, OAuth state, PKCE, and CSRF checks remain enabled.
  Fastify CORS allows credentials only for configured trusted origins.
- Better Auth applies narrow per-IP limits to sign-up, password sign-in, verification, recovery,
  and reset routes in addition to the API's general rate limit.
- The Fastify adapter removes password/token/provider/session fields from JSON response bodies.
  Cookie material exists only in the required `Set-Cookie` transport. Request logging redacts cookie,
  authorization, API-key, and idempotency headers; Better Auth diagnostic logging is disabled.
- Successful registration, verification, password reset, session creation/revocation, and role
  changes are append-only security events. Denied auth POSTs record only endpoint, status, and
  request ID—never email, password, token, OAuth state, or session material.

## Ownership contract for ticket 08

`resource_ownerships` binds one opaque `(resource_type, resource_id)` to a player account without an
early airline foreign key. Player queries call `listOwnedResourceIds(playerId, "airline")` (or join
on the same player predicate); commands call `requireOwnedResource` with the route/body airline ID
before loading or mutating domain state. Missing and foreign IDs return the same forbidden result,
so substituting another UUID neither reveals nor modifies that airline. Administrator tools use the
separate administrator check and do not silently inherit player ownership.

When ticket 08 creates the real `airlines` table, its founding transaction must:

1. lock/validate the verified player and founding eligibility;
2. insert the airline aggregate and obtain its UUID;
3. construct `KyselyIdentityRepository` with that same Kysely transaction;
4. call `bindResourceOwnership({ resourceType: "airline", resourceId: airline.id,
   playerAccountId })`; and
5. commit the airline, ownership binding, founding state, idempotency result, and outbox event
   together.

Ticket 08 may then add a forward foreign key from the airline-specific ownership model if useful;
it must not replace the player-scoped authorization predicate or use a client-supplied owner ID.
