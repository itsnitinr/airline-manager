import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import tzlookup from "tz-lookup";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  return rows;
}

function objectsFromCsv(text) {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error("CSV has no header.");
  return rows
    .filter((row) => row.length === header.length)
    .map((row) => Object.fromEntries(header.map((name, index) => [name, row[index] ?? ""])));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const [airportsPath, runwaysPath, zoneTablePath, outputPath] = process.argv.slice(2);
if (!airportsPath || !runwaysPath || !zoneTablePath || !outputPath) {
  throw new Error(
    "Usage: node scripts/generate-slice-one-fixture.mjs <airports.csv> <runways.csv> <zone.tab> <output.json>",
  );
}

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

const [airportsText, runwaysText, zoneTableText] = await Promise.all([
  readFile(resolve(repositoryRoot, airportsPath), "utf8"),
  readFile(resolve(repositoryRoot, runwaysPath), "utf8"),
  readFile(resolve(repositoryRoot, zoneTablePath), "utf8"),
]);
const longestRunway = new Map();
for (const runway of objectsFromCsv(runwaysText)) {
  if (runway.closed === "1" || !runway.length_ft) continue;
  const length = Number(runway.length_ft);
  if (Number.isFinite(length) && length > (longestRunway.get(runway.airport_ident) ?? 0)) {
    longestRunway.set(runway.airport_ident, length);
  }
}

const quotas = { AF: 25, AS: 60, EU: 60, NA: 60, OC: 20, SA: 25 };
const candidates = objectsFromCsv(airportsText)
  .filter(
    (airport) =>
      airport.type === "large_airport" &&
      airport.scheduled_service === "yes" &&
      airport.iata_code.length === 3 &&
      airport.icao_code.length === 4 &&
      airport.municipality &&
      airport.iso_country.length === 2 &&
      airport.iso_region.includes("-") &&
      Object.hasOwn(quotas, airport.continent) &&
      (longestRunway.get(airport.ident) ?? 0) >= 3000,
  )
  .map((airport) => ({
    ...airport,
    longest_runway_ft: longestRunway.get(airport.ident),
    timezone_name: tzlookup(Number(airport.latitude_deg), Number(airport.longitude_deg)),
  }));

const airports = Object.entries(quotas).flatMap(([region, quota]) =>
  candidates
    .filter((airport) => airport.continent === region)
    .sort((left, right) => {
      const documentationScore = (airport) =>
        Number(Boolean(airport.home_link)) + Number(Boolean(airport.wikipedia_link));
      return (
        documentationScore(right) - documentationScore(left) ||
        right.longest_runway_ft - left.longest_runway_ft ||
        left.ident.localeCompare(right.ident)
      );
    })
    .slice(0, quota)
    .map((airport) => ({
      source_record_id: airport.id,
      ident: airport.ident,
      iata_code: airport.iata_code,
      icao_code: airport.icao_code,
      name: airport.name,
      municipality: airport.municipality,
      country_code: airport.iso_country,
      region_code: airport.iso_region,
      world_region: airport.continent,
      latitude_deg: airport.latitude_deg,
      longitude_deg: airport.longitude_deg,
      elevation_ft: airport.elevation_ft || null,
      timezone_name: airport.timezone_name,
      longest_runway_ft: airport.longest_runway_ft,
      scheduled_service: true,
      commercial_relevance: "large_airport",
      source_home_link: airport.home_link || null,
      source_wikipedia_link: airport.wikipedia_link || null,
    })),
);

if (airports.length !== 250) throw new Error(`Expected 250 airports, got ${airports.length}.`);

const zoneRows = zoneTableText
  .split("\n")
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split("\t"));
const zones = new Map(
  zoneRows.map(([countries, coordinates, name, comment]) => [
    name,
    { country_codes: countries.split(","), coordinates, comment: comment || null },
  ]),
);
const timezones = [...new Set(airports.map(({ timezone_name }) => timezone_name))]
  .sort()
  .map((name) => {
    const definition = zones.get(name);
    if (!definition) throw new Error(`${name} is not present in IANA zone.tab.`);
    return { name, ...definition };
  });

const fixture = {
  schema_version: 1,
  generated_at: "2026-07-11T00:00:00.000Z",
  ourairports: {
    source_version: "2026-07-11",
    retrieved_at: "2026-07-11T00:00:00.000Z",
    airports_sha256: sha256(airportsText),
    runways_sha256: sha256(runwaysText),
    combined_sha256: sha256(`${sha256(airportsText)}:${sha256(runwaysText)}`),
  },
  iana: {
    version: "2026b",
    retrieved_at: "2026-07-11T00:00:00.000Z",
    archive_sha256: "114543d9f19a6bfeb5bca43686aea173d38755a3db1f2eec112647ae92c6f544",
  },
  distribution: quotas,
  timezones,
  airports,
};

await writeFile(
  resolve(repositoryRoot, outputPath),
  await format(JSON.stringify(fixture), { parser: "json" }),
  "utf8",
);
