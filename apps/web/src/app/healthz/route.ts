/** Liveness only. API, chain and indexer readiness are reported separately. */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response("ok", {
    status: 200,
    headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
  });
}
