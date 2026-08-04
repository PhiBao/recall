import pg from "pg";
import { env } from "./env";

const { Pool } = pg;
type PoolClient = pg.PoolClient;
type QueryResultRow = pg.QueryResultRow;
type PoolType = InstanceType<typeof Pool>;

/**
 * A single shared CockroachDB connection pool.
 *
 * We cache it on the Node global in development so Next.js hot-reload does not
 * open a new pool on every reload (which would exhaust connections).
 */
const globalForDb = globalThis as unknown as { __recallPool?: PoolType };

function createPool(): PoolType {
  const e = env();
  const pool = new Pool({
    connectionString: e.DATABASE_URL,
    // CockroachDB Serverless requires TLS; the connection string carries
    // sslmode. For managed clusters `verify-full` is used. Locally we allow
    // sslmode=disable via the connection string.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: "recall",
  });

  pool.on("error", (err) => {
    // A pooled client emitted an error while idle. Log, never crash the app —
    // this mirrors the hackathon thesis: memory must degrade gracefully.
    console.error("[db] idle client error:", err.message);
  });

  return pool;
}

export function pool(): PoolType {
  if (!globalForDb.__recallPool) {
    globalForDb.__recallPool = createPool();
  }
  return globalForDb.__recallPool;
}

/**
 * Run a parameterized query. Always use parameters ($1, $2, ...) — never string
 * interpolation — to prevent SQL injection.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool().query<T>(text, params as never[]);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Run a function inside a transaction. CockroachDB may retry serializable
 * transactions; callers should keep the body idempotent where possible.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback failure */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Format a JS number[] as a CockroachDB VECTOR literal, e.g. "[0.1,0.2]". */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.map((n) => (Number.isFinite(n) ? n : 0)).join(",")}]`;
}
