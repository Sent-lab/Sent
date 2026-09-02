/**
 * SENT — background job runner (§431).
 *
 * §431 asks for six things: idempotency, a retry policy, dead-letter visibility,
 * metrics, structured logs, and deterministic job identifiers. Each is a concrete
 * decision here rather than a property claimed in a comment.
 *
 * IDEMPOTENCY IS A PROPERTY OF HANDLERS, NOT OF THE QUEUE
 * --------------------------------------------------------
 * The queue can guarantee at-least-once and nothing stronger: a worker that dies
 * between doing the work and marking it done leaves a job that will run again.
 * Exactly-once would require the handler's effect and the status update to share
 * a transaction, which is not possible once an effect leaves PostgreSQL.
 *
 * So every handler must be safe to run twice. In practice that means recompute
 * and replace, never read-modify-write: `upsertCandles` overwrites a bucket
 * outright, and reconciliation derives balances from the event log rather than
 * adjusting the running total.
 *
 * RETRY IS BOUNDED AND VISIBLE
 * ----------------------------
 * Exponential backoff with a ceiling, then the dead letter. Unbounded retry is
 * worse than failure: a job that will never succeed retries forever, the error
 * scrolls past, and the queue looks busy rather than broken.
 */

import {
  Database,
  claimJob,
  completeJob,
  failJob,
  countJobsByStatus,
  type JobRecord,
} from "@sent/database";

export interface RunnerConfig {
  readonly maxAttempts: number;
  /** First retry delay in seconds; doubles per attempt up to the ceiling. */
  readonly baseBackoffSeconds: number;
  readonly maxBackoffSeconds: number;
  /** Pause when the queue is empty, in ms. */
  readonly idlePollMs: number;
}

export const DEFAULT_RUNNER_CONFIG: RunnerConfig = {
  maxAttempts: 5,
  baseBackoffSeconds: 10,
  maxBackoffSeconds: 900,
  idlePollMs: 2_000,
};

/** A unit of work. Must be safe to run more than once — see the header. */
export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

export interface RunnerMetrics {
  claimed: number;
  succeeded: number;
  retried: number;
  deadLettered: number;
  unknownKind: number;
  /** Total handler time in ms, for a mean that does not need a histogram. */
  handlerMs: number;
}

/**
 * Exponential backoff, capped.
 *
 * No jitter, deliberately: these jobs are keyed on deterministic ids, so two
 * workers cannot hold the same job and there is no thundering herd to spread
 * out. Jitter would only make failures harder to correlate in a log.
 */
export function backoffSeconds(attempt: number, config: RunnerConfig): number {
  const exponent = Math.max(0, attempt - 1);
  const delay = config.baseBackoffSeconds * 2 ** Math.min(exponent, 30);
  return Math.min(delay, config.maxBackoffSeconds);
}

/** One line of JSON per event. Greppable, parseable, no prose to match against. */
export function logLine(event: Record<string, unknown>): string {
  return JSON.stringify({ service: "worker", ...event });
}

/**
 * Whether a failed job retries, and when.
 *
 * Split out so the boundary can be tested directly. Off-by-one here is the
 * difference between a job that gets its last attempt and one that is dead
 * lettered while an attempt remains — invisible in a log, and only noticed when
 * work silently stops happening.
 */
export function retryDecision(
  job: { attempts: number; maxAttempts: number },
  config: RunnerConfig,
  now: number,
): { status: "PENDING" | "DEAD"; retryAt: number | null } {
  // `attempts` was already incremented by the claim, so it counts attempts USED.
  if (job.attempts >= job.maxAttempts) return { status: "DEAD", retryAt: null };
  return { status: "PENDING", retryAt: now + backoffSeconds(job.attempts, config) };
}

export class JobRunner {
  private readonly db: Database;
  private readonly config: RunnerConfig;
  private readonly handlers = new Map<string, JobHandler>();
  private running = false;

  readonly metrics: RunnerMetrics = {
    claimed: 0,
    succeeded: 0,
    retried: 0,
    deadLettered: 0,
    unknownKind: 0,
    handlerMs: 0,
  };

  constructor(db: Database, config: RunnerConfig = DEFAULT_RUNNER_CONFIG) {
    this.db = db;
    this.config = config;
  }

  register(kind: string, handler: JobHandler): void {
    if (this.handlers.has(kind)) {
      // Two handlers for one kind means the second silently wins and half the
      // jobs do the wrong thing. Better to refuse at wiring time.
      throw new Error(`JobRunner: handler for "${kind}" is already registered`);
    }
    this.handlers.set(kind, handler);
  }

  /**
   * Claim and run one job.
   *
   * Returns false when the queue is empty, which is the signal to idle rather
   * than to spin.
   */
  async step(now = Math.floor(Date.now() / 1000)): Promise<boolean> {
    const job = await claimJob(this.db, now);
    if (job === null) return false;

    this.metrics.claimed += 1;

    const handler = this.handlers.get(job.kind);
    if (handler === undefined) {
      // Dead-lettered immediately rather than retried. An unregistered kind is a
      // deployment mistake, and retrying it five times only delays finding out.
      this.metrics.unknownKind += 1;
      await failJob(this.db, job.id, `no handler registered for kind "${job.kind}"`, null, now);
      console.error(logLine({ level: "error", event: "job.unknown_kind", id: job.id, kind: job.kind }));
      return true;
    }

    const started = Date.now();

    try {
      await handler(job.payload);
      this.metrics.handlerMs += Date.now() - started;
      this.metrics.succeeded += 1;

      await completeJob(this.db, job.id, now);
      console.info(
        logLine({
          level: "info",
          event: "job.done",
          id: job.id,
          kind: job.kind,
          attempt: job.attempts,
          ms: Date.now() - started,
        }),
      );
    } catch (error) {
      this.metrics.handlerMs += Date.now() - started;
      await this.handleFailure(job, error, now);
    }

    return true;
  }

  private async handleFailure(job: JobRecord, error: unknown, now: number): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const { retryAt } = retryDecision(job, this.config, now);

    const status = await failJob(this.db, job.id, message, retryAt, now);

    if (status === "DEAD") {
      this.metrics.deadLettered += 1;
      console.error(
        logLine({
          level: "error",
          event: "job.dead",
          id: job.id,
          kind: job.kind,
          attempts: job.attempts,
          error: message,
        }),
      );
      return;
    }

    this.metrics.retried += 1;
    console.warn(
      logLine({
        level: "warn",
        event: "job.retry",
        id: job.id,
        kind: job.kind,
        attempt: job.attempts,
        retryAt,
        error: message,
      }),
    );
  }

  /** Drain the queue. Returns how many jobs ran. */
  async drain(limit = 1_000, now = Math.floor(Date.now() / 1000)): Promise<number> {
    let ran = 0;
    while (ran < limit && (await this.step(now))) ran += 1;
    return ran;
  }

  async start(): Promise<void> {
    this.running = true;

    while (this.running) {
      let worked = false;

      try {
        worked = await this.step();
      } catch (error) {
        // A failure OUTSIDE a handler — the database is unreachable, or a claim
        // raced. The loop must not exit: the queue is durable and the work is
        // still there when the connection comes back.
        console.error(
          logLine({
            level: "error",
            event: "worker.step_failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }

      if (!worked) await new Promise((resolve) => setTimeout(resolve, this.config.idlePollMs));
    }
  }

  stop(): void {
    this.running = false;
  }

  /** Queue depth by status, for the metrics endpoint (§431). */
  async queueDepth(): Promise<Record<string, number>> {
    return countJobsByStatus(this.db);
  }
}
