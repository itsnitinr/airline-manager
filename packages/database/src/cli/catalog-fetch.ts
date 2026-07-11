import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const executeFile = promisify(execFile);
const target = fileURLToPath(new URL("../../../../.data/reference-imports/", import.meta.url));

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url, {
    headers: { "user-agent": "airline-manager-reference-import/1" },
  });
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}.`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

await mkdir(resolve(target, "tzdata"), { recursive: true });
await Promise.all([
  download(
    "https://davidmegginson.github.io/ourairports-data/airports.csv",
    resolve(target, "airports.csv"),
  ),
  download(
    "https://davidmegginson.github.io/ourairports-data/runways.csv",
    resolve(target, "runways.csv"),
  ),
  download(
    "https://data.iana.org/time-zones/releases/tzdata2026b.tar.gz",
    resolve(target, "tzdata2026b.tar.gz"),
  ),
]);
await executeFile("tar", [
  "-xzf",
  resolve(target, "tzdata2026b.tar.gz"),
  "-C",
  resolve(target, "tzdata"),
  "zone.tab",
  "version",
]);
process.stdout.write(`Downloaded explicit reference inputs to ${target}.\n`);
