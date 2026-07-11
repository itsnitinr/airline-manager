import type { PoolConfig } from "pg";

export type DatabaseRuntimeRole = "api" | "worker" | "test" | "migration";

const defaultPoolSizes: Record<DatabaseRuntimeRole, number> = {
  api: 20,
  worker: 10,
  test: 5,
  migration: 1,
};

export type DatabasePoolOptions = Readonly<{
  connectionString: string;
  applicationName: string;
  maximumConnections: number;
  connectionTimeoutMilliseconds: number;
  idleTimeoutMilliseconds: number;
  statementTimeoutMilliseconds: number;
}>;

function readPositiveInteger(
  name: string,
  fallback: number,
  environment: NodeJS.ProcessEnv,
): number {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

export function readDatabasePoolOptions(
  role: DatabaseRuntimeRole,
  environment: NodeJS.ProcessEnv = process.env,
): DatabasePoolOptions {
  const roleUrlName =
    role === "test"
      ? "TEST_DATABASE_URL"
      : role === "migration"
        ? "MIGRATION_DATABASE_URL"
        : "DATABASE_URL";
  const connectionString = environment[roleUrlName]?.trim() || environment.DATABASE_URL?.trim();
  if (!connectionString) throw new Error(`${roleUrlName} or DATABASE_URL is required.`);

  return {
    connectionString,
    applicationName: environment.DATABASE_APPLICATION_NAME?.trim() || `airline-manager-${role}`,
    maximumConnections: readPositiveInteger(
      "DATABASE_POOL_MAX",
      defaultPoolSizes[role],
      environment,
    ),
    connectionTimeoutMilliseconds: readPositiveInteger(
      "DATABASE_CONNECT_TIMEOUT_MS",
      5_000,
      environment,
    ),
    idleTimeoutMilliseconds: readPositiveInteger("DATABASE_IDLE_TIMEOUT_MS", 30_000, environment),
    statementTimeoutMilliseconds: readPositiveInteger(
      "DATABASE_STATEMENT_TIMEOUT_MS",
      15_000,
      environment,
    ),
  };
}

export function toPgPoolConfig(options: DatabasePoolOptions): PoolConfig {
  return {
    connectionString: options.connectionString,
    application_name: options.applicationName,
    max: options.maximumConnections,
    connectionTimeoutMillis: options.connectionTimeoutMilliseconds,
    idleTimeoutMillis: options.idleTimeoutMilliseconds,
    statement_timeout: options.statementTimeoutMilliseconds,
    options: "-c timezone=UTC",
  };
}
