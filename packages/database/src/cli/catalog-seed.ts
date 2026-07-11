import { createDatabaseRuntime } from "../database.js";
import { readDatabasePoolOptions } from "../config.js";
import { seedSliceOneCatalog } from "../catalog/seed.js";

const runtime = createDatabaseRuntime(readDatabasePoolOptions("migration"));
try {
  const result = await seedSliceOneCatalog(runtime.database);
  process.stdout.write(
    `Published ${result.releaseVersion} for ${result.worldRulesetVersion}: ` +
      `${result.airportCount} airports, ${result.aircraftVariantCount} aircraft variants.\n`,
  );
} finally {
  await runtime.destroy();
}
