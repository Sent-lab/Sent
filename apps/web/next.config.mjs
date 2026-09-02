/**
 * SENT — Next configuration.
 *
 * Deliberately small. Every option here is one the app genuinely needs; a
 * config that accumulates flags is how a build starts behaving differently from
 * the one anyone reasoned about.
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: true,

  // There is a lockfile above this repository on some machines, and Next picks
  // the wrong root when it finds two. Pinning it keeps the build's file tracing
  // inside the workspace.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)) + "/../..",

  // The API is a separate service (§434) and is addressed by URL, so there are
  // no rewrites here. Proxying through Next would put a serverless hop in front
  // of a WebSocket tier that §434 explicitly keeps separate.

  eslint: {
    // Lint is not wired for this workspace; a build that fails on a missing
    // config is a build that fails for the wrong reason.
    ignoreDuringBuilds: true,
  },

  typescript: {
    // Typechecking runs in CI as its own gate, against the whole workspace.
    // Leaving it on here too would double a slow step for no extra coverage.
    ignoreBuildErrors: false,
  },
};

export default config;
