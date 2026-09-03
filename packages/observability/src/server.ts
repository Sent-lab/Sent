/**
 * SENT — the operations surface for services that are not HTTP servers (§437).
 *
 * The indexer, the finalizer and the worker are loops. They have no port, which
 * means an operator has no way to scrape them and an orchestrator has no way to
 * ask whether they are alive — and a background process that has silently
 * stopped looks exactly like one with nothing to do.
 *
 * So each gets two paths and nothing else:
 *
 *   /healthz   liveness, from the process's own view of itself
 *   /metrics   the Prometheus scrape
 *
 * NODE'S OWN http, NOT FASTIFY
 * ----------------------------
 * Two routes, no body parsing, no JSON schema, no plugins. Pulling a web
 * framework into a worker to serve two static paths would add a dependency to
 * three services in order to avoid twenty lines.
 *
 * LIVENESS IS NOT READINESS
 * -------------------------
 * `/healthz` answers "is this process still doing its job", which is what an
 * orchestrator restarts on. It deliberately does not report whether the
 * PROJECTION is fresh — that is §211's question, the API answers it, and a
 * worker that restarted itself every time the chain was slow would turn a
 * degraded dependency into an outage.
 */

import { createServer, type Server } from "node:http";

import type { Registry } from "./metrics.ts";
import type { Logger } from "./logger.ts";

export interface OperationsOptions {
  readonly port: number;
  readonly host?: string;
  readonly registry: Registry;
  readonly logger: Logger;
  /**
   * The process's own view of whether it is working.
   *
   * Returns a reason when it is not, so the body says what is wrong rather than
   * only that something is. An operator reading a 503 with no reason has to go
   * to the logs anyway.
   */
  readonly liveness: () => { readonly ok: boolean; readonly reason?: string };
}

export interface Operations {
  close(): Promise<void>;
  readonly port: number;
}

export async function serveOperations(options: OperationsOptions): Promise<Operations> {
  const host = options.host ?? "0.0.0.0";

  const server: Server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0];

    if (path === "/metrics") {
      response.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
      response.end(options.registry.render());
      return;
    }

    if (path === "/healthz") {
      const state = options.liveness();

      // 503 rather than 500: this is a dependency-or-state problem, not a bug
      // in the handler, and the distinction is what a load balancer reads.
      response.writeHead(state.ok ? 200 : 503, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: state.ok, reason: state.reason ?? null }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: "not found" }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  options.logger.info("operations surface listening", { host, port: options.port });

  return {
    port: options.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
