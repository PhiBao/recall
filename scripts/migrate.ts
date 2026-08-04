/**
 * Applies lib/schema.sql to the configured CockroachDB cluster.
 *
 * Usage: pnpm db:migrate
 *
 * The schema uses IF NOT EXISTS everywhere so this is safe to re-run.
 * If the cluster does not support CREATE VECTOR INDEX (older version), we log a
 * clear, actionable error instead of failing silently.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { loadEnv } from "./load-env";

const { Client } = pg;

// Minimal .env loader (avoids adding a dependency): read .env.local / .env.
loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env.local.");
    process.exit(1);
  }

  const schemaPath = join(__dirname, "..", "lib", "schema.sql");
  const sql = await readFile(schemaPath, "utf8");

  const client = new Client({ connectionString: url });
  await client.connect();
  console.log("[migrate] connected to CockroachDB");

  // The `pg` driver supports multiple statements in a single query() call.
  // Our schema uses only simple DDL (no PL/pgSQL bodies), so we apply the whole
  // file at once — this avoids fragile semicolon-splitting that can drop
  // statements and silently create nothing.
  try {
    await client.query(sql);
    console.log("[migrate] schema applied ✔");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/vector/i.test(msg) && /(unknown|unsupported|syntax)/i.test(msg)) {
      console.error(
        `[migrate] FAILED on a VECTOR statement: ${msg}\n` +
          "Your CockroachDB version may not support vector indexing. " +
          "Use CockroachDB v24.3+ (Serverless clusters are up to date).",
      );
    } else {
      console.error(`[migrate] FAILED:\n  ${msg}`);
    }
    await client.end();
    process.exit(1);
  }

  // Verify the core tables actually exist so "done" always means done.
  const check = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'app_user'`,
  );
  if (Number(check.rows[0]?.n ?? 0) !== 1) {
    console.error("[migrate] FAILED: app_user table was not created.");
    await client.end();
    process.exit(1);
  }

  await client.end();
  console.log("[migrate] done ✔");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
