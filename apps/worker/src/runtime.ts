import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import {
  DrainCoordinator,
  DueAircraftDeliveryHandler,
  VersionedHandlerRegistry,
  authorizeReplay,
  classifyJobError,
  deterministicJobId,
  parseJobEnvelope,
  redactDiagnostic,
  type HandlerOutcome,
  type JobEnvelopeV1,
  type ReplayAuthorization,
} from "@airline-manager/application";
import {
  KyselyFleetRepository,
  KyselyRuntimeRepository,
  runtimeIdentity,
  type DatabaseRuntime,
} from "@airline-manager/database";

export const QUEUE_NAME = "simulation-runtime-v1";

export type WorkerRuntimeOptions = Readonly<{
  databaseRuntime: DatabaseRuntime;
  redisUrl: string;
  now?: () => Date;
  concurrency?: number;
  outboxBatchSize?: number;
  reconciliationBatchSize?: number;
  claimLeaseMilliseconds?: number;
  drainMilliseconds?: number;
  pollMilliseconds?: number;
}>;

type MetricName =
  | "published"
  | "publishFailures"
  | "handlerApplied"
  | "handlerNoops"
  | "handlerFailures"
  | "deadLetters"
  | "reconciliationRecovered"
  | "releasedLeases";

export class RuntimeMetrics {
  readonly #counters = new Map<MetricName, number>();
  lag = { outbox: 0, milestones: 0, outboxLagSeconds: 0, milestoneLagSeconds: 0, failures: 0 };
  increment(name: MetricName, value = 1): void {
    this.#counters.set(name, (this.#counters.get(name) ?? 0) + value);
  }
  get(name: MetricName): number {
    return this.#counters.get(name) ?? 0;
  }
  render(draining: boolean, active: number): string {
    const lines = [
      "# TYPE airline_worker_events_total counter",
      ...[...this.#counters].map(
        ([name, value]) => `airline_worker_events_total{outcome="${name}"} ${value}`,
      ),
      "# TYPE airline_worker_outbox_backlog gauge",
      `airline_worker_outbox_backlog ${this.lag.outbox}`,
      `airline_worker_milestone_backlog ${this.lag.milestones}`,
      `airline_worker_outbox_lag_seconds ${this.lag.outboxLagSeconds}`,
      `airline_worker_milestone_lag_seconds ${this.lag.milestoneLagSeconds}`,
      `airline_worker_outbox_failures ${this.lag.failures}`,
      `airline_worker_draining ${draining ? 1 : 0}`,
      `airline_worker_active_jobs ${active}`,
    ];
    return `${lines.join("\n")}\n`;
  }
}

function connectionFromUrl(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:")
    throw new Error("REDIS_URL must use redis or rediss.");
  const database = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: database,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

export class SimulationWorkerRuntime {
  readonly owner = runtimeIdentity();
  readonly metrics = new RuntimeMetrics();
  readonly drain = new DrainCoordinator();
  readonly repository: KyselyRuntimeRepository;
  readonly queue: Queue<JobEnvelopeV1>;
  readonly worker: Worker<JobEnvelopeV1, HandlerOutcome>;
  readonly registry = new VersionedHandlerRegistry();
  readonly #now: () => Date;
  readonly #options: Required<Omit<WorkerRuntimeOptions, "databaseRuntime" | "redisUrl" | "now">>;
  #timers: NodeJS.Timeout[] = [];
  #started = false;

  constructor(readonly input: WorkerRuntimeOptions) {
    this.#now = input.now ?? (() => new Date());
    this.#options = {
      concurrency: input.concurrency ?? 8,
      outboxBatchSize: input.outboxBatchSize ?? 50,
      reconciliationBatchSize: input.reconciliationBatchSize ?? 100,
      claimLeaseMilliseconds: input.claimLeaseMilliseconds ?? 30_000,
      drainMilliseconds: input.drainMilliseconds ?? 25_000,
      pollMilliseconds: input.pollMilliseconds ?? 1_000,
    };
    this.repository = new KyselyRuntimeRepository(input.databaseRuntime.database);
    const connection = connectionFromUrl(input.redisUrl);
    this.queue = new Queue<JobEnvelopeV1>(QUEUE_NAME, { connection });
    this.registry.register("outbox.event", 1, async () => ({
      kind: "noop",
      detail: "transport publication",
    }));
    const delivery = new DueAircraftDeliveryHandler(
      new KyselyFleetRepository(input.databaseRuntime.database),
      { now: this.#now },
    );
    this.registry.register("aircraft.delivery", 1, async (envelope) => {
      const aircraft = await delivery.execute(envelope.entityId, BigInt(envelope.expectedVersion));
      return BigInt(aircraft.version) > BigInt(envelope.expectedVersion)
        ? { kind: "applied" }
        : { kind: "duplicate" };
    });
    // Ticket 16 transports these persisted intents. Their gameplay-specific transitions remain with later tickets.
    for (const kind of [
      "workforce.checkpoint_due.v1",
      "maintenance.checkpoint_due.v1",
      "weather.forecast_due.v1",
      "weather.realization_due.v1",
    ]) {
      this.registry.register(kind, 1, async () => ({
        kind: "noop",
        detail: "registered for domain handler integration",
      }));
    }
    this.worker = new Worker<JobEnvelopeV1, HandlerOutcome>(
      QUEUE_NAME,
      (job) => this.process(job),
      {
        connection,
        concurrency: this.#options.concurrency,
        lockDuration: this.#options.claimLeaseMilliseconds,
        maxStalledCount: 2,
        stalledInterval: Math.max(5_000, Math.floor(this.#options.claimLeaseMilliseconds / 2)),
        autorun: false,
      },
    );
    this.worker.on("failed", (job, error) => {
      void this.onFailed(job, error);
    });
    this.worker.on("error", (error) =>
      this.log("worker_error", undefined, { error: error.message }),
    );
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    await this.queue.waitUntilReady();
    void this.worker.run().catch((error: unknown) =>
      this.log("worker_run_failed", undefined, {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    await this.tick();
    this.#timers = [
      setInterval(() => {
        void this.publishOutbox();
      }, this.#options.pollMilliseconds),
      setInterval(
        () => {
          void this.reconcile();
        },
        Math.max(2_000, this.#options.pollMilliseconds * 5),
      ),
      setInterval(
        () => {
          void this.refreshLag();
        },
        Math.max(2_000, this.#options.pollMilliseconds * 5),
      ),
      setInterval(() => {
        void this.repository.retain(this.#now());
      }, 60_000),
    ];
    this.#timers.forEach((timer) => timer.unref());
  }

  private async tick(): Promise<void> {
    await Promise.all([this.publishOutbox(), this.reconcile(), this.refreshLag()]);
  }

  async publishOutbox(): Promise<void> {
    if (this.drain.draining) return;
    const rows = await this.repository.claimOutbox({
      owner: this.owner,
      now: this.#now(),
      leaseMilliseconds: this.#options.claimLeaseMilliseconds,
      limit: this.#options.outboxBatchSize,
    });
    for (const row of rows) {
      try {
        await this.enqueue(row.envelope);
        await this.repository.markOutboxPublished(row.id, this.owner, this.#now(), 7 * 86_400_000);
        this.metrics.increment("published");
        this.log("outbox_published", row.envelope);
      } catch (error) {
        this.metrics.increment("publishFailures");
        await this.repository.releaseOutbox(row.id, this.owner, error, this.#now(), 12);
        this.log("outbox_publish_failed", row.envelope, { error });
      }
    }
  }

  async reconcile(): Promise<void> {
    if (this.drain.draining) return;
    await this.repository.synchronizeExistingIntents();
    const now = this.#now();
    const due = await this.repository.claimDueMilestones({
      owner: this.owner,
      now,
      overdueBefore: now,
      leaseMilliseconds: this.#options.claimLeaseMilliseconds,
      limit: this.#options.reconciliationBatchSize,
    });
    for (const envelope of due) {
      try {
        await this.enqueue(envelope);
        await this.repository.releaseMilestone(envelope, this.owner);
        this.metrics.increment("reconciliationRecovered");
      } catch (error) {
        await this.repository.releaseMilestone(envelope, this.owner);
        this.log("reconciliation_enqueue_failed", envelope, { error });
      }
    }
  }

  async enqueue(envelope: JobEnvelopeV1, jobId = deterministicJobId(envelope)): Promise<void> {
    const delay = Math.max(0, new Date(envelope.targetTime).getTime() - this.#now().getTime());
    await this.queue.add(envelope.handlerKind, envelope, {
      jobId,
      delay,
      attempts: 6,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: { age: 86_400, count: 10_000 },
      removeOnFail: false,
    });
  }

  async replay(deadLetterId: string, authorization: ReplayAuthorization): Promise<string> {
    authorizeReplay(authorization);
    const envelope = await this.repository.getDeadLetterEnvelope(deadLetterId);
    const replayJobId = `${deterministicJobId(envelope)}-replay-${authorization.requestId}`;
    await this.enqueue(envelope, replayJobId);
    await this.repository.auditReplay(deadLetterId, authorization, replayJobId);
    return replayJobId;
  }

  private async process(job: Job<JobEnvelopeV1>): Promise<HandlerOutcome> {
    const finish = this.drain.tryStart();
    if (!finish) throw new Error("Worker is draining.");
    let envelope: JobEnvelopeV1 | undefined;
    try {
      envelope = parseJobEnvelope(job.data, this.#now());
      const outcome = await this.registry.dispatch(envelope, this.#now());
      if (outcome.kind === "applied") this.metrics.increment("handlerApplied");
      else this.metrics.increment("handlerNoops");
      if (envelope.routing.source === "reconciliation" && outcome.kind !== "premature") {
        await this.repository.markMilestoneApplied(envelope, this.#now());
      }
      this.log("handler_completed", envelope, { outcome: outcome.kind });
      return outcome;
    } catch (error) {
      this.metrics.increment("handlerFailures");
      const classification = classifyJobError(error);
      if (classification !== "retryable") {
        job.discard();
        await this.repository.recordDeadLetter({
          jobId: job.id ?? "unknown",
          queueName: QUEUE_NAME,
          classification,
          ...(envelope ? { envelope } : {}),
          diagnostic: {
            error: error instanceof Error ? error.message : String(error),
            data: job.data,
          },
          now: this.#now(),
          retentionMilliseconds: 30 * 86_400_000,
        });
        this.metrics.increment("deadLetters");
      }
      this.log("handler_failed", envelope, { classification, error });
      throw error;
    } finally {
      finish();
    }
  }

  private async onFailed(job: Job<JobEnvelopeV1> | undefined, error: Error): Promise<void> {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    let envelope: JobEnvelopeV1 | undefined;
    try {
      envelope = parseJobEnvelope(job.data);
    } catch {
      /* malformed is already quarantined */
    }
    await this.repository.recordDeadLetter({
      jobId: job.id ?? "unknown",
      queueName: QUEUE_NAME,
      classification: "exhausted",
      ...(envelope ? { envelope } : {}),
      diagnostic: { error: error.message },
      now: this.#now(),
      retentionMilliseconds: 30 * 86_400_000,
    });
    this.metrics.increment("deadLetters");
  }

  async refreshLag(): Promise<void> {
    this.metrics.lag = await this.repository.lag(this.#now());
  }

  status(): Readonly<{
    draining: boolean;
    active: number;
    ready: boolean;
    lag: RuntimeMetrics["lag"];
  }> {
    return {
      draining: this.drain.draining,
      active: this.drain.active,
      ready: this.#started && !this.drain.draining,
      lag: this.metrics.lag,
    };
  }

  async shutdown(): Promise<boolean> {
    this.#timers.splice(0).forEach(clearInterval);
    await this.worker.pause(true);
    const drained = await this.drain.drain(this.#options.drainMilliseconds);
    await this.worker.close(!drained);
    await this.queue.close();
    const released = await this.repository.releaseOwnerLeases(this.owner);
    this.metrics.increment("releasedLeases", released);
    return drained;
  }

  private log(event: string, envelope?: JobEnvelopeV1, detail: unknown = {}): void {
    process.stdout.write(
      `${JSON.stringify(redactDiagnostic({ level: "info", service: "worker", event, commandId: envelope?.commandId, entityId: envelope?.entityId, correlationId: envelope?.correlationId, causationId: envelope?.causationId, handlerKind: envelope?.handlerKind, detail }))}\n`,
    );
  }
}
