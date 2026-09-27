/**
 * Seed a demo user with a realistic set of networking memories, so the app is
 * immediately explorable (and the demo tells a story).
 *
 * Usage: pnpm seed
 * Sign in with demo@recall.app to see the seeded memory.
 *
 * This runs the SAME capture pipeline the app uses (extraction → Walrus
 * remember → person → facts → commitments), so every seeded memory becomes a
 * real blob in Walrus Memory — counting toward the Session's ≥10-blob proof.
 */
import { loadEnv } from "./load-env";
loadEnv();

import { captureMemory } from "../lib/memory";
import { createUser, findUserByEmail, loadStore, saveStore } from "../lib/store";

const DEMO_EMAIL = "demo@recall.app";
const DEMO_NAME = "Alex Rivera";

// Backdated so some follow-ups are already "overdue" for the demo.
const MEMORIES: string[] = [
  "Met Sarah Chen at the SF AI meetup. She's a founder at Nimbus, building AI eval tooling, ex-Stripe. She's hiring senior React engineers. Promised to intro her to my friend Priya who's looking.",
  "Coffee with Marcus Webb, a partner at Foundry Ventures. He invests in dev tools and infra at seed. Loves rock climbing. Said I'd send him our deck by Friday.",
  "Call with Dr. Lena Ortiz, research scientist at MIT working on retrieval systems. Interested in memory architectures for agents. Has a daughter named Mia starting college. Should follow up with the paper I mentioned.",
  "Ran into Tomás Silva at the conference. He runs growth at Loop, a fintech in Lisbon. Into padel and specialty coffee. Wants to compare notes on onboarding funnels. Need to schedule a working session.",
  "DM'd with Aisha Khan, design lead at Vercel. She's exploring leaving to start something in creator tools. Big on accessibility. I said I'd share the founder community I'm in.",
  "Dinner with Ravi Menon, eng manager at Datadog. Hiring for a platform team. Kid just started playing chess. We talked about on-call culture. Owe him a referral for the SRE role.",
];

function getOrCreateDemoUser(): string {
  const existing = findUserByEmail(DEMO_EMAIL);
  if (existing) return existing.id;
  return createUser(DEMO_EMAIL, DEMO_NAME).id;
}

async function main() {
  const userId = getOrCreateDemoUser();

  // Idempotent-ish: skip if this user already has memories.
  const store = loadStore();
  const existing = store.memories.filter((m) => m.user_id === userId).length;
  if (existing > 0) {
    console.log(
      `[seed] demo user already has memories — skipping. Sign in as ${DEMO_EMAIL}.`,
    );
    process.exit(0);
  }

  console.log(`[seed] capturing ${MEMORIES.length} memories for ${DEMO_EMAIL}…`);
  for (const [i, text] of MEMORIES.entries()) {
    const res = await captureMemory(userId, text);
    const blob = res.memory.walrus_blob_id ? ` blob=${res.memory.walrus_blob_id}` : " (local only)";
    console.log(`[seed]  ${i + 1}. ${res.summary}${blob}`);
  }

  // Make a couple of follow-ups overdue so the Today feed is lively.
  const ids = loadStore()
    .commitments.filter((c) => c.user_id === userId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, 2)
    .map((c) => c.id);
  if (ids.length > 0) {
    const s = loadStore();
    for (const c of s.commitments) {
      if (ids.includes(c.id)) {
        c.due_at = new Date(Date.now() - 2 * 86400_000).toISOString();
      }
    }
    saveStore(s);
  }

  const blobs = loadStore().memories.filter(
    (m) => m.user_id === userId && m.walrus_blob_id,
  ).length;
  console.log(`[seed] done ✔  Sign in as ${DEMO_EMAIL} (${blobs} Walrus blobs)`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
