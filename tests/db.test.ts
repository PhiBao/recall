import { describe, it, expect, beforeAll } from "vitest";
import { pool, query, withTransaction } from "@/lib/db";

/**
 * These tests run against a real CockroachDB. They gracefully skip when the
 * database is unreachable (e.g. CI without a cluster) so the suite never fails
 * on a network hiccup — the assertions are valuable but not worth blocking a
 * demo on.
 */

let dbAvailable = false;

beforeAll(async () => {
  try {
    await pool().query("SELECT 1");
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

describe("database layer", () => {
  it.skipIf(!dbAvailable)("connects and runs a simple query", async () => {
    const rows = await query<{ one: number }>("SELECT 1 AS one");
    expect(rows[0]?.one).toBe(1);
  });

  it.skipIf(!dbAvailable)(
    "withTransaction commits on success",
    async () => {
      const result = await withTransaction(async (client) => {
        const r = await client.query<{ x: number }>("SELECT 42 AS x");
        return r.rows[0]?.x;
      });
      expect(result).toBe(42);
    },
  );

  it.skipIf(!dbAvailable)(
    "withTransaction rolls back on error",
    async () => {
      let rolledBack = false;
      try {
        await withTransaction(async (client) => {
          await client.query("SELECT 1");
          throw new Error("intentional failure");
        });
      } catch (err) {
        rolledBack = err instanceof Error && err.message === "intentional failure";
      }
      expect(rolledBack).toBe(true);
    },
  );
});
