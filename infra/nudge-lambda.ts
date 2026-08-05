/**
 * AWS Lambda handler for Recall's daily nudge cron.
 *
 * Runs the same stale-relationship reconnect logic as `scripts/run-nudges.ts`,
 * but serverless: triggered by an EventBridge (CloudWatch Events) schedule rule
 * (e.g. rate(1 day)). This is the "agents that act" piece of the hackathon
 * thesis — the agent proactively creates follow-ups without being asked.
 *
 * Deploy:
 *   1. Bundle this handler (it has no external deps beyond Node's `pg`,
 *      which must be bundled or layered).
 *   2. Create a Lambda with handler `nudge-lambda.handler`.
 *   3. Set env: DATABASE_URL (Secrets Manager recommended), NODE_ENV=production.
 *   4. Add an EventBridge rule: `rate(1 day)` → this Lambda.
 *
 * The handler is idempotent: it won't create a second open "reconnect"
 * commitment for a person who already has one.
 */
import pg from "pg";

const { Pool } = pg;
const STALE_DAYS = 30;

// Reuse the pool across warm invocations.
const globalForLambda = globalThis as unknown as { __nudgePool?: pg.Pool };
function pool(): pg.Pool {
  if (!globalForLambda.__nudgePool) {
    globalForLambda.__nudgePool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      ssl: { rejectUnauthorized: true },
    });
  }
  return globalForLambda.__nudgePool;
}

interface LambdaEvent {
  // EventBridge scheduled events carry these; we ignore them and just run.
  source?: string;
  "detail-type"?: string;
}

export async function handler(_event: LambdaEvent): Promise<{
  statusCode: number;
  body: string;
}> {
  const stale = await pool().query(
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

  if (stale.rowCount === 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({ created: 0, message: "no stale relationships" }),
    };
  }

  let created = 0;
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    for (const row of stale.rows) {
      await client.query(
        `INSERT INTO commitment (user_id, person_id, description, due_at, status)
         VALUES ($1, $2, $3, now(), 'open')`,
        [row.user_id, row.person_id, `Reconnect with ${row.name}`],
      );
      await client.query(
        `INSERT INTO audit_log (user_id, action, detail) VALUES ($1, 'nudge_created', $2)`,
        [row.user_id, JSON.stringify({ personId: row.person_id })],
      );
      created++;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[nudge-lambda] failed:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "nudge run failed" }),
    };
  } finally {
    client.release();
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ created }),
  };
}
