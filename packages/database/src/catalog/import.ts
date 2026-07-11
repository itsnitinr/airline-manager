import { createHash } from "node:crypto";
import { sql } from "kysely";
import type { Database } from "../database.js";
import type { AirportCandidate } from "./validation.js";
import { validateAirportCandidate } from "./validation.js";

export type AirportImportInput = Readonly<{
  sourceVersion: string;
  checksum: string;
  retrievedAt: string;
  metadata: Readonly<Record<string, string>>;
  records: readonly AirportCandidate[];
  validTimezones: ReadonlySet<string>;
}>;

export type AirportImportResult = Readonly<{
  importId: string;
  insertedRecords: number;
  validRecords: number;
  quarantinedRecords: number;
}>;

function checksumPayload(payload: AirportCandidate): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function importOurAirports(
  database: Database,
  input: AirportImportInput,
): Promise<AirportImportResult> {
  const imported = await sql<{ id: string }>`
    INSERT INTO raw_reference_imports
      (source_id, dataset_name, source_version, sha256, first_retrieved_at,
       last_retrieved_at, record_count, metadata)
    VALUES
      ('ourairports', 'airports-with-runways', ${input.sourceVersion}, ${input.checksum},
       ${input.retrievedAt}::timestamptz, ${input.retrievedAt}::timestamptz,
       ${input.records.length}, ${JSON.stringify(input.metadata)}::jsonb)
    ON CONFLICT (source_id, dataset_name, source_version, sha256) DO UPDATE SET
      last_retrieved_at = GREATEST(raw_reference_imports.last_retrieved_at, EXCLUDED.last_retrieved_at),
      retrieval_count = raw_reference_imports.retrieval_count + 1
    RETURNING id
  `.execute(database);
  const importId = imported.rows[0]?.id;
  if (!importId) throw new Error("OurAirports import did not return an identifier.");

  let insertedRecords = 0;
  let validRecords = 0;
  let quarantinedRecords = 0;
  for (const record of input.records) {
    const inserted = await sql<{ id: string }>`
      INSERT INTO raw_reference_records
        (import_id, source_record_id, payload, payload_sha256)
      VALUES
        (${importId}::uuid, ${record.source_record_id}, ${JSON.stringify(record)}::jsonb,
         ${checksumPayload(record)})
      ON CONFLICT (import_id, source_record_id) DO NOTHING
      RETURNING id
    `.execute(database);
    if (inserted.rows.length > 0) insertedRecords += 1;
    const raw =
      inserted.rows[0] ??
      (
        await sql<{ id: string }>`SELECT id FROM raw_reference_records
          WHERE import_id = ${importId}::uuid AND source_record_id = ${record.source_record_id}`.execute(
          database,
        )
      ).rows[0];
    if (!raw) throw new Error(`Raw record ${record.source_record_id} was not persisted.`);

    const validations = validateAirportCandidate(record, input.validTimezones);
    for (const validation of validations) {
      await sql`INSERT INTO reference_validation_results
        (raw_record_id, rule_code, passed, severity, message)
        VALUES (${raw.id}::uuid, ${validation.ruleCode}, ${validation.passed},
          ${validation.severity}, ${validation.message})
        ON CONFLICT (raw_record_id, rule_code) DO UPDATE SET
          passed = EXCLUDED.passed, severity = EXCLUDED.severity,
          message = EXCLUDED.message, validated_at = CURRENT_TIMESTAMP`.execute(database);
    }
    const valid = validations.every(({ passed, severity }) => passed || severity !== "error");
    if (valid) validRecords += 1;
    else quarantinedRecords += 1;
    await sql`UPDATE raw_reference_records SET disposition = ${valid ? "validated" : "quarantined"}
      WHERE id = ${raw.id}::uuid AND disposition <> 'promoted'`.execute(database);
  }
  await sql`UPDATE raw_reference_imports SET status = 'validated'
    WHERE id = ${importId}::uuid`.execute(database);
  return { importId, insertedRecords, validRecords, quarantinedRecords };
}
