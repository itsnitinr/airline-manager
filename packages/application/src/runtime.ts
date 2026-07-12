export const JOB_ENVELOPE_VERSION = 1 as const;
export const supportedHandlerVersion = 1 as const;

export type JobEnvelopeV1 = Readonly<{
  envelopeVersion: 1;
  commandId: string;
  entityId: string;
  entityType: string;
  expectedVersion: string;
  correlationId: string;
  causationId: string;
  targetTime: string;
  handlerKind: string;
  handlerVersion: number;
  routing: Readonly<Record<string, string>>;
}>;

export type HandlerOutcomeKind = "applied" | "duplicate" | "stale" | "premature" | "noop";
export type HandlerOutcome = Readonly<{ kind: HandlerOutcomeKind; detail?: string }>;
export type JobHandler = (envelope: JobEnvelopeV1) => Promise<HandlerOutcome>;

export class UnsupportedEnvelopeError extends Error {}
export class InvalidEnvelopeError extends Error {}
export class UnsupportedHandlerError extends Error {}
export class PermanentJobError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_NAME = /^[a-z][a-z0-9_.-]{0,127}$/;
const FORBIDDEN_KEY =
  /(?:amount|balance|booking|cash|cost|currency|fare|money|passenger|password|payload|revenue|secret|snapshot|token|connection.?string)/i;
const ENVELOPE_KEYS = new Set([
  "envelopeVersion",
  "commandId",
  "entityId",
  "entityType",
  "expectedVersion",
  "correlationId",
  "causationId",
  "targetTime",
  "handlerKind",
  "handlerVersion",
  "routing",
]);

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidEnvelopeError("Job envelope must be an object.");
  }
  return value as Record<string, unknown>;
}

function stringField(input: Record<string, unknown>, name: string, pattern?: RegExp): string {
  const value = input[name];
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    throw new InvalidEnvelopeError(`Invalid ${name}.`);
  }
  return value;
}

export function assertSafeRoutingData(value: unknown): asserts value is Record<string, string> {
  const routing = record(value);
  for (const [key, item] of Object.entries(routing)) {
    if (
      FORBIDDEN_KEY.test(key) ||
      typeof item !== "string" ||
      item.length > 256 ||
      /(?:bearer\s+|token=|password=|:\/\/[^/\s]+:[^/\s]+@)/i.test(item)
    ) {
      throw new InvalidEnvelopeError(`Unsafe routing field: ${key}.`);
    }
  }
}

export function parseJobEnvelope(value: unknown, now = new Date()): JobEnvelopeV1 {
  const input = record(value);
  for (const key of Object.keys(input)) {
    if (!ENVELOPE_KEYS.has(key))
      throw new InvalidEnvelopeError(`Unexpected envelope field: ${key}.`);
  }
  if (input.envelopeVersion !== JOB_ENVELOPE_VERSION) {
    throw new UnsupportedEnvelopeError(
      `Unsupported envelope version: ${String(input.envelopeVersion)}.`,
    );
  }
  const targetTime = stringField(input, "targetTime");
  const parsedTarget = new Date(targetTime);
  if (Number.isNaN(parsedTarget.getTime())) throw new InvalidEnvelopeError("Invalid targetTime.");
  const handlerVersion = input.handlerVersion;
  if (!Number.isSafeInteger(handlerVersion) || (handlerVersion as number) < 1) {
    throw new InvalidEnvelopeError("Invalid handlerVersion.");
  }
  assertSafeRoutingData(input.routing);
  const envelope: JobEnvelopeV1 = {
    envelopeVersion: JOB_ENVELOPE_VERSION,
    commandId: stringField(input, "commandId", UUID),
    entityId: stringField(input, "entityId", UUID),
    entityType: stringField(input, "entityType", SAFE_NAME),
    expectedVersion: stringField(input, "expectedVersion", /^[1-9][0-9]*$/),
    correlationId: stringField(input, "correlationId", UUID),
    causationId: stringField(input, "causationId", UUID),
    targetTime: parsedTarget.toISOString(),
    handlerKind: stringField(input, "handlerKind", SAFE_NAME),
    handlerVersion: handlerVersion as number,
    routing: Object.freeze({ ...input.routing }),
  };
  // Parsing does not reject early work: handlers must return a premature no-op.
  void now;
  return Object.freeze(envelope);
}

export function deterministicJobId(envelope: JobEnvelopeV1): string {
  return [
    `v${envelope.envelopeVersion}`,
    envelope.handlerKind,
    envelope.handlerVersion,
    envelope.entityType,
    envelope.entityId,
    envelope.expectedVersion,
    new Date(envelope.targetTime).getTime(),
  ].join("-");
}

export function redactDiagnostic(value: unknown): unknown {
  if (value instanceof Error) return { name: value.name, message: redactDiagnostic(value.message) };
  if (Array.isArray(value)) return value.map(redactDiagnostic);
  if (typeof value === "string") {
    return value
      .replace(/(?:token|secret|password|connection[_-]?string)=[^\s,;]+/gi, "[REDACTED]")
      .replace(/bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]");
  }
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      FORBIDDEN_KEY.test(key) ? "[REDACTED]" : redactDiagnostic(item),
    ]),
  );
}

export type RetryClassification = "retryable" | "permanent" | "unsupported";

export function classifyJobError(error: unknown): RetryClassification {
  if (error instanceof UnsupportedEnvelopeError || error instanceof UnsupportedHandlerError) {
    return "unsupported";
  }
  if (error instanceof InvalidEnvelopeError || error instanceof PermanentJobError)
    return "permanent";
  return "retryable";
}

export function retryBackoffMilliseconds(attempt: number, base = 1_000, maximum = 60_000): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error("attempt must be positive.");
  return Math.min(maximum, base * 2 ** (attempt - 1));
}

export class VersionedHandlerRegistry {
  readonly #handlers = new Map<string, JobHandler>();

  register(kind: string, version: number, handler: JobHandler): void {
    const key = `${kind}@${version}`;
    if (!SAFE_NAME.test(kind) || !Number.isSafeInteger(version) || version < 1) {
      throw new Error("Handler identity is invalid.");
    }
    if (this.#handlers.has(key)) throw new Error(`Handler already registered: ${key}.`);
    this.#handlers.set(key, handler);
  }

  async dispatch(envelope: JobEnvelopeV1, now = new Date()): Promise<HandlerOutcome> {
    if (new Date(envelope.targetTime).getTime() > now.getTime()) return { kind: "premature" };
    const key = `${envelope.handlerKind}@${envelope.handlerVersion}`;
    const handler = this.#handlers.get(key);
    if (!handler) throw new UnsupportedHandlerError(`Unsupported handler: ${key}.`);
    return handler(envelope);
  }
}

export class DrainCoordinator {
  #draining = false;
  #active = 0;
  #waiters: Array<() => void> = [];

  get draining(): boolean {
    return this.#draining;
  }
  get active(): number {
    return this.#active;
  }
  tryStart(): (() => void) | undefined {
    if (this.#draining) return undefined;
    this.#active += 1;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.#active -= 1;
      if (this.#active === 0) this.#waiters.splice(0).forEach((resolve) => resolve());
    };
  }
  async drain(timeoutMilliseconds: number): Promise<boolean> {
    this.#draining = true;
    if (this.#active === 0) return true;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), timeoutMilliseconds);
      this.#waiters.push(() => {
        clearTimeout(timeout);
        resolve(true);
      });
    });
  }
}

export type ReplayAuthorization = Readonly<{
  actorIdentifier: string;
  isAdministrator: boolean;
  reason: string;
  requestId: string;
}>;

export function authorizeReplay(input: ReplayAuthorization): void {
  if (!input.isAdministrator || input.reason.trim().length < 8 || !UUID.test(input.requestId)) {
    throw new PermanentJobError(
      "Replay requires an attributed administrator and a meaningful reason.",
    );
  }
}
