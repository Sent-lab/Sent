/**
 * SENT — migration runner.
 *
 * The indexer applies migrations on start, so this exists for the cases where
 * that is not what you want: checking what WOULD run before a deploy, and
 * applying the schema to a database no service is pointed at yet.
 *
 * Usage:
 *   node --experimental-strip-types infra/migrations/run.ts          # apply
 *   node --experimental-strip-types infra/migrations/run.ts --status # report only
 *
 * It never rolls back. A down-migration on a projection is the wrong tool: the
 * whole database is rebuildable from chain events (§138), so recovering from a
 * bad migration means dropping and reindexing, which is a known-good path rather
 * than a reverse script nobody has run.
 */

import { Database, migrate, loadMigrations } from "@sent/database";
import { databaseEnv } from "@sent/config/env";

async function main(): Promise<void> {
  const statusOnly = process.argv.includes("--status");

  const db = new Database(databaseEnv());
  const migrations = loadMigrations();

  try {
    if (statusOnly) {
      // Reads the ledger without creating it. A --status run must not leave a
      // trace on a database it was only asked to inspect.
      const applied = new Set(
        (
          await db
            .query<{ name: string }>("SELECT name FROM schema_migrations")
            .catch(() => [] as { name: string }[])
        ).map((row) => row.name),
      );

      for (const migration of migrations) {
        console.log(`${applied.has(migration.name) ? "applied" : "PENDING"}  ${migration.name}`);
      }

      const pending = migrations.filter((m) => !applied.has(m.name)).length;
      console.log(`\n${migrations.length} migration(s), ${pending} pending`);

      // Non-zero when work is outstanding, so a deploy pipeline can gate on it
      // without parsing this output.
      process.exit(pending === 0 ? 0 : 1);
    }

    const ran = await migrate(db, migrations);

    console.log(
      ran.length === 0 ? "schema already up to date" : `applied: ${ran.join(", ")}`,
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(`migration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
