/**
 * Re-seed embeddings through the real pipeline.
 *
 * Run this AFTER enabling Titan model access in the Bedrock console. It
 * regenerates the vector index from scratch so every memory has a real
 * semantic embedding instead of the local hash fallback — this is what makes
 * paraphrase recall work in the demo.
 *
 * Steps:
 *   1. pnpm embed:verify          # confirm real embeddings work
 *   2. pnpm db:seed-embeddings     # regenerate all embeddings
 *
 * Safe to re-run: it wipes and rebuilds only the embedding rows.
 */
import { loadEnv } from "./load-env";
loadEnv();

import { pool, query } from "../lib/db";
import { embed } from "../lib/ai";

async function main() {
  const client = await pool();
  const memories = await query<{ id: string; content: string }>(
    `SELECT id, content FROM memory`,
  );

  if (memories.length === 0) {
    console.log("[reseed] no memories found — run pnpm db:seed first.");
    process.exit(0);
  }

  console.log(`[reseed] regenerating embeddings for ${memories.length} memories…`);

  // Wipe existing (fallback) embeddings.
  await client.query(`DELETE FROM memory_embedding`);

  let ok = 0;
  for (const m of memories) {
    const v = await embed(m.content);
    await client.query(
      `INSERT INTO memory_embedding (memory_id, user_id, embedding)
       SELECT $1, user_id, $2::vector FROM memory WHERE id = $1`,
      [m.id, `[${v.join(",")}]`],
    );
    ok++;
    console.log(`[reseed]  ${ok}/${memories.length}  ${m.content.slice(0, 60)}…`);
  }

  // Sanity check: are these real vectors now?
  const sample = await query<{ n: number }>(
    `SELECT count(DISTINCT embedding::text)::int AS n FROM memory_embedding`,
  );
  console.log(`[reseed] done ✔  ${ok} embeddings regenerated (${sample[0]?.n} distinct vectors).`);
  console.log(`[reseed] run pnpm embed:verify to confirm semantics.`);
  await pool().end();
  process.exit(0);
}

main().catch((err) => {
  console.error("[reseed] failed:", err);
  process.exit(1);
});
