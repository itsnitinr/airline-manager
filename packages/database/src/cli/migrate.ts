import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { readDatabasePoolOptions, toPgPoolConfig } from "../config.js";

const migrationPattern = /^\d{4}_[a-z0-9_]+\.sql$/;
const lockKey = 1_946_754_321;

type Migration = Readonly<{ name: string; sql: string; checksum: string }>;

async function loadMigrations(directory: string): Promise<Migration[]> {
  const names = (await readdir(directory)).filter((name) => migrationPattern.test(name)).sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(resolve(directory, name), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    }),
  );
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  const migrations = await loadMigrations(
    fileURLToPath(new URL("../../migrations", import.meta.url)),
  );
  if (migrations.length === 0) throw new Error("No SQL migrations were found.");

  const client = new pg.Client(toPgPoolConfig(readDatabasePoolOptions("migration")));
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [lockKey]);
    const tableExists = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists",
    );
    const applied = tableExists.rows[0]?.exists
      ? await client.query<{ name: string; checksum: string }>(
          "SELECT name, checksum FROM schema_migrations ORDER BY name",
        )
      : { rows: [] };
    const known = new Map(migrations.map((migration) => [migration.name, migration]));

    for (const row of applied.rows) {
      const migration = known.get(row.name);
      if (!migration) {
        throw new Error(`Applied migration ${row.name} is missing from the repository.`);
      }
      if (migration.checksum !== row.checksum.trim()) {
        throw new Error(`Applied migration ${row.name} has been modified.`);
      }
    }

    const appliedNames = new Set(applied.rows.map((row) => row.name));
    const pending = migrations.filter((migration) => !appliedNames.has(migration.name));
    if (checkOnly) {
      if (pending.length > 0) {
        throw new Error(`Unapplied migrations: ${pending.map(({ name }) => name).join(", ")}`);
      }
      process.stdout.write("Database schema is current.\n");
      return;
    }

    for (const migration of pending) {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '60s'");
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [
          migration.name,
          migration.checksum,
        ]);
        await client.query("COMMIT");
        process.stdout.write(`Applied ${migration.name}.\n`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    process.stdout.write(
      pending.length === 0 ? "Database schema already current.\n" : "Database schema is current.\n",
    );
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [lockKey]).catch(() => undefined);
    await client.end();
  }
}

await main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
