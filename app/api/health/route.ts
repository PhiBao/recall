import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { isMockAI } from "@/lib/env";

/**
 * Health check for App Runner (and human eyes). Verifies the database is
 * reachable, the core tables exist, the vector index is present, and reports
 * whether the AI layer is on the real Bedrock path or the deterministic fallback.
 *
 * GET /api/health
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, unknown> = {
    status: "ok",
    timestamp: new Date().toISOString(),
    ai: isMockAI() ? "mock-fallback" : "bedrock",
  };

  try {
    await pool().query("SELECT 1");
    checks.database = "connected";

    const tables = await query<{ name: string }>(
      `SELECT table_schema || '.' || table_name AS name
         FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name`,
    );
    checks.tables = tables.map((t) => t.name);

    const vecIdx = await query<{ name: string }>(
      `SELECT indexname AS name FROM pg_indexes
        WHERE indexname = 'memory_embedding_idx'`,
    );
    checks.vectorIndex = vecIdx.length > 0 ? "present" : "missing";

    const counts = await query<{ metric: string; n: string }>(
      `SELECT 'memories'::text AS metric, count(*)::string AS n FROM memory
         UNION ALL
       SELECT 'people', count(*)::string FROM person
         UNION ALL
       SELECT 'open_commitments', count(*)::string FROM commitment WHERE status = 'open'`,
    );
    checks.counts = Object.fromEntries(counts.map((c) => [c.metric, c.n]));

    return NextResponse.json(checks, { status: 200 });
  } catch (err) {
    checks.status = "error";
    checks.error = err instanceof Error ? err.message : String(err);
    return NextResponse.json(checks, { status: 503 });
  }
}
