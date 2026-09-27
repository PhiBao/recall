/**
 * Relationship nudge generator (run on a schedule, e.g. daily cron).
 *
 * Creates gentle "reconnect" follow-ups for people who have gone cold — no
 * interaction in STALE_DAYS — so relationships don't quietly decay. This is the
 * retention engine: it gives the user a reason to come back every day.
 *
 * Idempotent: it will not create a second open "reconnect" commitment for a
 * person who already has one.
 *
 * Usage: pnpm nudge:run
 */
import { loadEnv } from "./load-env";
loadEnv();

import { addCommitment, audit, loadStore, stalePeople } from "../lib/store";

const STALE_DAYS = 30;

async function main() {
  const users = loadStore().users;
  let created = 0;
  for (const u of users) {
    const stale = stalePeople(u.id, STALE_DAYS);
    for (const row of stale) {
      addCommitment({
        userId: row.user_id,
        personId: row.person_id,
        description: `Reconnect with ${row.name}`,
        dueAt: new Date().toISOString(),
        sourceMemoryId: null,
      });
      audit(row.user_id, "nudge_created", { personId: row.person_id });
      created++;
    }
  }

  if (created === 0) {
    console.log("[nudge] no stale relationships — nothing to do.");
  } else {
    console.log(`[nudge] created ${created} reconnect nudge(s).`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[nudge] failed:", err);
  process.exit(1);
});
