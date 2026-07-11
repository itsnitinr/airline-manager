import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const probeUrl = new URL("../packages/domain/src/__forbidden-boundary-probe__.ts", import.meta.url);
const probePath = fileURLToPath(probeUrl);
const forbiddenImports = ["@airline-manager/database", "@airline-manager/web", "bullmq", "fastify"];

try {
  for (const moduleName of forbiddenImports) {
    writeFileSync(probePath, `import "${moduleName}";\n`, "utf8");

    const result = spawnSync("pnpm", ["exec", "eslint", probePath], {
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    if (result.error) {
      throw result.error;
    }
    if (result.status === 0 || !output.includes("no-restricted-imports")) {
      throw new Error(`Forbidden domain import of ${moduleName} was not rejected.\n${output}`);
    }
  }

  process.stdout.write(
    `Boundary check passed: ${forbiddenImports.length} deliberate domain imports were rejected.\n`,
  );
} finally {
  rmSync(probePath, { force: true });
}
