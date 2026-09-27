/**
 * Verify the TypeSafe judgment layer live (Jev).
 *
 * Exercises all four judgments with real calls, including the regression
 * case that Bedrock extraction got wrong (Ravi vs David Okafor):
 *   pnpm judge:verify
 * Requires: TYPESAFE_API_KEY in .env.local
 */
import { loadEnv } from "./load-env";
loadEnv();

import {
  findPersonSpans,
  isJudgeConfigured,
  resolvePersonName,
  routeIntent,
  scoreRelevance,
  verifyCitations,
} from "../lib/judge";

async function main() {
  if (!isJudgeConfigured()) {
    console.error("[judge] TYPESAFE_API_KEY is not set — add it to .env.local.");
    process.exit(1);
  }

  // 1. Intent routing.
  const remember = await routeIntent(
    "Met Sarah Chen at the AI meetup — founder at Nimbus, hiring React engineers.",
  );
  const recallQ = await routeIntent("Who do I know that's hiring React engineers?");
  console.log("[judge] route remember →", remember?.intent, `(conf ${remember?.confidence.toFixed(2)})`);
  console.log("[judge] route recall   →", recallQ?.intent, `(conf ${recallQ?.confidence.toFixed(2)})`);
  if (remember?.intent !== "remember" || recallQ?.intent !== "recall") {
    console.error("[judge] FAIL — intent routing wrong");
    process.exit(1);
  }

  // 2. Person resolution — the regression case.
  const tricky =
    "Lunch with David Okafor, CTO at Paystack. Scaling the eng org from 20 to 60. Said I'd intro him to Ravi to compare notes on on-call.";
  const spans = findPersonSpans(tricky);
  console.log("[judge] spans:", spans.join(" | "));
  const picked = await resolvePersonName(tricky, ["Sarah Chen", "Ravi Menon", ...spans]);
  console.log("[judge] person →", picked?.name, `(conf ${picked?.confidence.toFixed(2)})`);
  if (picked?.name !== "David Okafor") {
    console.error("[judge] FAIL — picked the intro mention instead of the subject");
    process.exit(1);
  }

  // 3. Relevance ranking — paraphrase, no shared keywords.
  const scored = await scoreRelevance("Who is recruiting frontend people?", [
    { id: "sarah", text: "Sarah Chen: founder at Nimbus, hiring senior React engineers." },
    { id: "marcus", text: "Marcus Webb: partner at Foundry Ventures, invests in dev tools." },
    { id: "milk", text: "Buy milk and bread on the way home." },
  ]);
  console.log(
    "[judge] rerank →",
    scored?.map((s) => `${s.id}=${s.score.toFixed(2)}`).join(" "),
  );
  if (scored?.[0]?.id !== "sarah") {
    console.error("[judge] FAIL — paraphrase did not rank first");
    process.exit(1);
  }

  // 4. Citation verification.
  const verdicts = await verifyCitations([
    {
      id: "c1",
      claim: "Sarah Chen is hiring senior React engineers.",
      source: "Met Sarah Chen at the AI meetup — founder at Nimbus, hiring senior React engineers.",
    },
    {
      id: "c2",
      claim: "Sarah Chen left Nimbus to join Figma.",
      source: "Met Sarah Chen at the AI meetup — founder at Nimbus, hiring senior React engineers.",
    },
  ]);
  console.log("[judge] citations →", JSON.stringify(verdicts));
  if (verdicts?.c1?.verdict !== "verified" || verdicts?.c2?.verdict === "verified") {
    console.error("[judge] FAIL — citation verdicts wrong");
    process.exit(1);
  }

  console.log("[judge] PASS ✔ — Jev decides, Voxtral writes.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[judge] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
