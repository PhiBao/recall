import { NextResponse } from "next/server";
import { isMockAI } from "@/lib/env";
import { storeCounts } from "@/lib/store";
import { isMemwalConfigured, walrusHealth } from "@/lib/memwal";

/**
 * Health check (and human eyes). Reports the AI path, the local projection
 * counts, and Walrus Memory status: configured, reachable, and how many
 * blobs this deployment has persisted (the hackathon's proof-of-memory).
 *
 * GET /api/health
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const memwal = await walrusHealth();
  const body: Record<string, unknown> = {
    status: "ok",
    timestamp: new Date().toISOString(),
    ai: isMockAI() ? "mock-fallback" : "bedrock",
    memory: "walrus",
    walrus: {
      configured: memwal.configured || isMemwalConfigured(),
      reachable: memwal.reachable,
      latencyMs: memwal.latencyMs,
      serverUrl: process.env.MEMWAL_SERVER_URL ?? "https://relayer.memory.walrus.xyz",
    },
    counts: storeCounts(),
  };
  return NextResponse.json(body, { status: 200 });
}
