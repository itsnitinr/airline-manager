import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const boundaryChecks = [
  {
    probeUrl: new URL("../packages/domain/src/__forbidden-boundary-probe__.ts", import.meta.url),
    forbiddenImports: ["@airline-manager/database", "@airline-manager/web", "bullmq", "fastify"],
  },
  {
    probeUrl: new URL(
      "../packages/application/src/__forbidden-boundary-probe__.ts",
      import.meta.url,
    ),
    forbiddenImports: ["@airline-manager/api", "@airline-manager/worker", "fastify", "bullmq"],
  },
];

try {
  for (const { probeUrl, forbiddenImports } of boundaryChecks) {
    const probePath = fileURLToPath(probeUrl);
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
        throw new Error(`Forbidden import of ${moduleName} was not rejected.\n${output}`);
      }
    }
    rmSync(probePath, { force: true });
  }

  process.stdout.write(
    `Boundary check passed: ${boundaryChecks.reduce((total, check) => total + check.forbiddenImports.length, 0)} deliberate imports were rejected.\n`,
  );
} finally {
  for (const { probeUrl } of boundaryChecks) {
    rmSync(fileURLToPath(probeUrl), { force: true });
  }
}
