import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { toPgPoolConfig, type DatabasePoolOptions } from "./config.js";
import type { DB } from "./generated/database.js";

export type Database = Kysely<DB>;

export interface DatabaseRuntime {
  readonly database: Database;
  readonly pool: pg.Pool;
  isReady(): Promise<boolean>;
  destroy(): Promise<void>;
}

export function createDatabaseRuntime(options: DatabasePoolOptions): DatabaseRuntime {
  const pool = new pg.Pool(toPgPoolConfig(options));
  pool.on("error", () => undefined);
  const database = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

  return {
    database,
    pool,
    async isReady() {
      try {
        await pool.query("SELECT 1");
        return true;
      } catch {
        return false;
      }
    },
    async destroy() {
      await database.destroy();
    },
  };
}
