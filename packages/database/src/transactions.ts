import { sql, type Kysely, type Transaction } from "kysely";

export type TransactionIsolationLevel = "read committed" | "repeatable read" | "serializable";

export type TransactionOptions = Readonly<{
  isolationLevel?: TransactionIsolationLevel;
  maximumAttempts?: number;
  statementTimeoutMilliseconds?: number;
  retryDelayMilliseconds?: (attempt: number) => number;
}>;

const RETRYABLE_TRANSACTION_CODES = new Set(["40001", "40P01"]);

export function isRetryableTransactionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    RETRYABLE_TRANSACTION_CODES.has(error.code)
  );
}

export async function runInTransaction<TDatabase, TResult>(
  database: Kysely<TDatabase>,
  callback: (transaction: Transaction<TDatabase>) => Promise<TResult>,
  options: TransactionOptions = {},
): Promise<TResult> {
  const isolationLevel = options.isolationLevel ?? "read committed";
  const maximumAttempts = options.maximumAttempts ?? 3;
  const statementTimeoutMilliseconds = options.statementTimeoutMilliseconds ?? 5_000;
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1) {
    throw new Error("maximumAttempts must be a positive integer.");
  }
  if (!Number.isSafeInteger(statementTimeoutMilliseconds) || statementTimeoutMilliseconds < 1) {
    throw new Error("statementTimeoutMilliseconds must be a positive integer.");
  }

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await database
        .transaction()
        .setIsolationLevel(isolationLevel)
        .execute(async (transaction) => {
          const timeout = `${statementTimeoutMilliseconds}ms`;
          await sql`SELECT set_config('statement_timeout', ${timeout}, true)`.execute(transaction);
          await sql`SELECT set_config('idle_in_transaction_session_timeout', ${timeout}, true)`.execute(
            transaction,
          );
          return callback(transaction);
        });
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt >= maximumAttempts) throw error;
      const delay = options.retryDelayMilliseconds?.(attempt) ?? attempt * 10;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
