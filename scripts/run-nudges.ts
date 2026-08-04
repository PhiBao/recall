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

import { query } from "../lib/db";

const STALE_DAYS = 30;

async function main() {
  // Find (user, person) pairs that are stale and don't already have an open
  // reconnect nudge. One statement, scoped per row's user_id.
  const stale = await query<{
    user_id: string;
    person_id: string;
    name: string;
    last_interaction_at: string | null;
  }>(
    `SELECT p.user_id, p.id AS person_id, p.name, p.last_interaction_at
       FROM person p
      WHERE (p.last_interaction_at IS NULL
             OR p.last_interaction_at < now() - ($1 || ' days')::interval)
        AND NOT EXISTS (
          SELECT 1 FROM commitment c
           WHERE c.person_id = p.id
             AND c.status = 'open'
             AND c.description LIKE 'Reconnect with%'
        )
      LIMIT 500`,
    [String(STALE_DAYS)],
  );

  if (stale.length === 0) {
    console.log("[nudge] no stale relationships — nothing to do.");
    process.exit(0);
  }

  let created = 0;
  for (const row of stale) {
    await query(
      `INSERT INTO commitment (user_id, person_id, description, due_at, status)
       VALUES ($1, $2, $3, now(), 'open')`,
      [row.user_id, row.person_id, `Reconnect with ${row.name}`],
    );
    await query(
      `INSERT INTO audit_log (user_id, action, detail) VALUES ($1, 'nudge_created', $2)`,
      [row.user_id, JSON.stringify({ personId: row.person_id })],
    );
    created++;
  }

  console.log(`[nudge] created ${created} reconnect nudge(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[nudge] failed:", err);
  process.exit(1);
});
