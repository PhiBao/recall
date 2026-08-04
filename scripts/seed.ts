/**
 * Seed a demo user with a realistic set of networking memories, so the app is
 * immediately explorable (and the demo tells a story).
 *
 * Usage: pnpm db:seed
 * Sign in with demo@recall.app to see the seeded memory.
 *
 * This runs the SAME capture pipeline the app uses (extraction → person →
 * memory → embedding → facts → commitments), so the vector index and Today
 * feed are populated exactly as they would be in production.
 */
import { loadEnv } from "./load-env";
loadEnv();

import { query } from "../lib/db";
import { captureMemory } from "../lib/memory";

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

async function getOrCreateDemoUser(): Promise<string> {
  const existing = await query<{ id: string }>(
    `SELECT id FROM app_user WHERE email = $1`,
    [DEMO_EMAIL],
  );
  if (existing[0]) return existing[0].id;
  const created = await query<{ id: string }>(
    `INSERT INTO app_user (email, name) VALUES ($1, $2) RETURNING id`,
    [DEMO_EMAIL, DEMO_NAME],
  );
  const id = created[0]?.id;
  if (!id) throw new Error("Failed to create demo user");
  return id;
}

async function main() {
  const userId = await getOrCreateDemoUser();

  // Idempotent-ish: skip if this user already has memories.
  const count = await query<{ n: string }>(
    `SELECT count(*)::string AS n FROM memory WHERE user_id = $1`,
    [userId],
  );
  if (Number(count[0]?.n ?? "0") > 0) {
    console.log(
      `[seed] demo user already has memories — skipping. Sign in as ${DEMO_EMAIL}.`,
    );
    process.exit(0);
  }

  console.log(`[seed] capturing ${MEMORIES.length} memories for ${DEMO_EMAIL}…`);
  for (const [i, text] of MEMORIES.entries()) {
    const res = await captureMemory(userId, text);
    console.log(`[seed]  ${i + 1}. ${res.summary}`);
  }

  // Make a couple of follow-ups overdue so the Today feed is lively.
  await query(
    `UPDATE commitment
        SET due_at = now() - INTERVAL '2 days'
      WHERE user_id = $1
        AND id IN (SELECT id FROM commitment WHERE user_id = $1 ORDER BY created_at ASC LIMIT 2)`,
    [userId],
  );

  console.log(`[seed] done ✔  Sign in as ${DEMO_EMAIL}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
