import pg from "pg";
import { createClient } from "redis";

export interface DatabaseLifecycle {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export type DependencyReadiness = Readonly<{
  postgres: boolean;
  redis: boolean;
}>;

export type InfrastructureConnectionOptions = Readonly<{
  databaseUrl: string;
  redisUrl: string;
  timeoutMilliseconds?: number;
}>;

async function checkPostgres(
  connectionString: string,
  timeoutMilliseconds: number,
): Promise<boolean> {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: timeoutMilliseconds,
    query_timeout: timeoutMilliseconds,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMilliseconds: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error("Dependency check timed out.")),
      timeoutMilliseconds,
    );
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function checkRedis(url: string, timeoutMilliseconds: number): Promise<boolean> {
  const client = createClient({
    url,
    socket: { connectTimeout: timeoutMilliseconds, reconnectStrategy: false },
  });
  client.on("error", () => undefined);
  try {
    await client.connect();
    return (await withTimeout(client.ping(), timeoutMilliseconds)) === "PONG";
  } catch {
    return false;
  } finally {
    if (client.isOpen) client.destroy();
  }
}

export function createInfrastructureReadinessCheck(
  options: InfrastructureConnectionOptions,
): () => Promise<DependencyReadiness> {
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 1_500;
  return async () => {
    const [postgres, redis] = await Promise.all([
      checkPostgres(options.databaseUrl, timeoutMilliseconds),
      checkRedis(options.redisUrl, timeoutMilliseconds),
    ]);
    return { postgres, redis };
  };
}
