import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenApiDocument } from "../src/openapi.js";

const mode = process.argv[2];
if (mode !== "write" && mode !== "check") {
  throw new Error("Usage: generate-contract.mts <write|check>");
}

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const checkedOpenApiPath = join(repoRoot, "apps/api/openapi.json");
const checkedClientPath = join(repoRoot, "packages/contracts/src/generated");
const temporaryRoot = mkdtempSync(join(tmpdir(), "airline-manager-contract-"));

function listFiles(directory: string, prefix = ""): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = join(prefix, entry.name);
    return entry.isDirectory() ? listFiles(join(directory, entry.name), relative) : [relative];
  });
}

function assertSameDirectory(expected: string, actual: string): void {
  const expectedFiles = listFiles(expected).sort();
  const actualFiles = listFiles(actual).sort();
  if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)) {
    throw new Error("Generated API client file list is stale. Run pnpm api:contract:generate.");
  }
  for (const file of expectedFiles) {
    if (readFileSync(join(expected, file), "utf8") !== readFileSync(join(actual, file), "utf8")) {
      throw new Error(`Generated API client is stale at ${file}. Run pnpm api:contract:generate.`);
    }
  }
}

try {
  const generatedOpenApiPath = join(temporaryRoot, "openapi.json");
  const generatedClientPath = join(temporaryRoot, "client");
  const document = await createOpenApiDocument();
  writeFileSync(generatedOpenApiPath, document, "utf8");

  const generation = spawnSync(
    "pnpm",
    [
      "--filter",
      "@airline-manager/api",
      "exec",
      "openapi-ts",
      "--input",
      generatedOpenApiPath,
      "--output",
      generatedClientPath,
      "--plugins",
      "@hey-api/typescript",
      "--silent",
      "--no-log-file",
    ],
    { cwd: repoRoot, encoding: "utf8", shell: process.platform === "win32" },
  );
  if (generation.error) throw generation.error;
  if (generation.status !== 0) {
    throw new Error(`Typed client generation failed.\n${generation.stdout}${generation.stderr}`);
  }
  const formatting = spawnSync(
    "pnpm",
    [
      "exec",
      "prettier",
      "--config",
      join(repoRoot, ".prettierrc.json"),
      "--write",
      generatedOpenApiPath,
      generatedClientPath,
    ],
    { cwd: repoRoot, encoding: "utf8", shell: process.platform === "win32" },
  );
  if (formatting.error) throw formatting.error;
  if (formatting.status !== 0) {
    throw new Error(
      `Generated contract formatting failed.\n${formatting.stdout}${formatting.stderr}`,
    );
  }
  const formattedDocument = readFileSync(generatedOpenApiPath, "utf8");

  if (mode === "write") {
    writeFileSync(checkedOpenApiPath, formattedDocument, "utf8");
    rmSync(checkedClientPath, { recursive: true, force: true });
    mkdirSync(checkedClientPath, { recursive: true });
    for (const file of listFiles(generatedClientPath)) {
      const destination = join(checkedClientPath, file);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, readFileSync(join(generatedClientPath, file)));
    }
    process.stdout.write("OpenAPI document and typed client generated.\n");
  } else {
    if (
      !existsSync(checkedOpenApiPath) ||
      readFileSync(checkedOpenApiPath, "utf8") !== formattedDocument
    ) {
      throw new Error("OpenAPI document is stale. Run pnpm api:contract:generate.");
    }
    assertSameDirectory(checkedClientPath, generatedClientPath);
    process.stdout.write("OpenAPI document and typed client are current.\n");
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
