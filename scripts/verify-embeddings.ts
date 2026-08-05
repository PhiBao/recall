/**
 * Verify the real Amazon Titan embedding path end-to-end.
 *
 * The app silently falls back to a deterministic local hash embedding when
 * Titan is unavailable, so a broken embedding path is easy to miss. This script
 * calls the SAME embed() the app uses and asserts the result is a real
 * high-dimensional vector (not the 2-value hash fallback), then runs a semantic
 * similarity sanity check so you can see that paraphrases score closer than
 * unrelated sentences.
 *
 * Usage: pnpm embed:verify
 *
 * Exit code 0 = real Titan embeddings working. Non-zero = still on the fallback
 * (check Bedrock Model access + IAM bedrock:InvokeModel).
 */
import { loadEnv } from "./load-env";
loadEnv();

import { embed } from "../lib/ai";
import { env } from "../lib/env";

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function main() {
  const e = env();
  console.log(`[verify] region=${e.AWS_REGION} model=${e.BEDROCK_EMBED_MODEL_ID} dim=${e.EMBED_DIMENSIONS}`);
  console.log(
    `[verify] auth: IAM keys ${e.AWS_ACCESS_KEY_ID ? "present" : "MISSING"}, Bedrock API key ${
      e.BEDROCK_API_KEY ? "present" : "MISSING"
    }`,
  );

  const v = await embed("CockroachDB is a distributed SQL database with vector indexing.");
  const distinct = new Set(v.map((x) => x.toFixed(6))).size;

  console.log(`[verify] embedding length: ${v.length}`);
  console.log(`[verify] distinct values (of ${v.length}): ${distinct}`);

  // The local hash embedding collapses to very few distinct values; a real
  // Titan vector has hundreds. This is the tell.
  const looksReal = v.length === e.EMBED_DIMENSIONS && distinct > 50;
  if (!looksReal) {
    console.error(
      `[verify] FAIL — embedding looks like the local fallback (only ${distinct} distinct values).\n` +
        `        Real Titan embeddings need:\n` +
        `        1. Bedrock Model access: enable "${e.BEDROCK_EMBED_MODEL_ID}" in the Bedrock console (us-east-1).\n` +
        `        2. IAM permission: bedrock:InvokeModel on the model ARN.\n` +
        `        See: https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html`,
    );
    process.exit(1);
  }

  // Semantic sanity: a paraphrase should be closer than an unrelated sentence.
  const a = await embed("She is recruiting senior frontend engineers.");
  const b = await embed("They are hiring React developers."); // paraphrase
  const c = await embed("The weather in Lisbon is sunny today."); // unrelated

  const simAB = cosine(a, b);
  const simAC = cosine(a, c);
  console.log(`[verify] cosine(paraphrase)     = ${simAB.toFixed(4)}`);
  console.log(`[verify] cosine(unrelated)      = ${simAC.toFixed(4)}`);

  if (simAB > simAC) {
    console.log(`[verify] PASS — real Titan embeddings working, and semantics are coherent.`);
  } else {
    console.warn(
      `[verify] WARN — embeddings are real but the paraphrase scored closer than expected.\n` +
        `        This can happen with very short inputs; try longer sentences.`,
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[verify] ERROR:", err);
  process.exit(1);
});
