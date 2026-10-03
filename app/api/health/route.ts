import { NextResponse } from "next/server";
import { isMockAI } from "@/lib/env";
import { storeCounts } from "@/lib/store";
import {
  isMemwalConfigured,
  userNamespace,
  walrusHealth,
  walrusRestore,
} from "@/lib/memwal";
import { getUserId } from "@/lib/auth";

/**
 * Health check (and human eyes). Reports the AI path, the local projection
 * counts, and Walrus Memory status: configured, reachable, latency, the
 * account that owns the blobs, per-user namespace, storage lifetime, and how
 * many certified blobs exist (the Session's proof-of-memory).
 *
 * GET /api/health
 */
export const dynamic = "force-dynamic";

// Walrus SDK default: 50 epochs ≈ 2 years on mainnet (2-week epochs).
const WALRUS_EPOCHS = 50;

export async function GET() {
  const memwal = await walrusHealth();
  const configured = memwal.configured || isMemwalConfigured();
  const body: Record<string, unknown> = {
    status: "ok",
    timestamp: new Date().toISOString(),
    ai: isMockAI() ? "mock-fallback" : "bedrock",
    memory: "walrus",
    walrus: {
      configured,
      reachable: memwal.reachable,
      latencyMs: memwal.latencyMs,
      serverUrl:
        process.env.MEMWAL_SERVER_URL ?? "https://relayer.memory.walrus.xyz",
      account: process.env.MEMWAL_ACCOUNT_ID ?? null,
      storage: {
        epochs: WALRUS_EPOCHS,
        approxYears: (WALRUS_EPOCHS * 14) / 365,
        note: "Walrus blobs are immutable and content-addressed; expiry is renewed by the relayer for the operator account.",
      },
    },
    counts: storeCounts(),
  };

  // When called by a signed-in user, prove THEIR namespace specifically.
  try {
    const userId = await getUserId();
    if (userId) {
      const ns = userNamespace(userId);
      const restore = await walrusRestore(userId, 25);
      body.you = {
        namespace: ns,
        onChainBlobs: restore?.total ?? null,
        indexed: restore !== null,
        note: "onChainBlobs is discovered from Sui, not from the app's own index",
      };
    }
  } catch {
    // Anonymous health check — fine.
  }

  return NextResponse.json(body, { status: 200 });
}
