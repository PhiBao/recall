import { TypeSafeClient, choice, noul } from "@typesafe-ai/sdk";
import { env } from "./env";
import { log } from "./log";

/**
 * Calibrated judgments (TypeSafe Jev) — every *decision* in Recall's pipeline.
 *
 * Thesis: a generative LLM is good at writing words and bad at being
 * accountable for choices. So Jev decides and Voxtral only writes:
 *
 *   - routeIntent ......... Choice(remember | recall) — drives the Composer
 *   - resolvePersonName .... Choice over roster + detected spans (+ none hatch)
 *   - scoreRelevance ....... one batched Noul per (question, memory) pair
 *   - verifyCitations ...... one batched Choice per (claim, source) pair
 *
 * Every answer carries probabilities + confidence, so code — not vibes —
 * controls behavior: low-confidence routes fall back, low-relevance memories
 * never reach synthesis, and every citation ships a machine-checked verdict.
 *
 * All functions return null when TypeSafe is unconfigured or fails; callers
 * MUST fall back to the Bedrock generative paths. Nothing here may throw.
 */

let client: TypeSafeClient | null = null;

/** Test seam: inject a fake client (or null to reset). */
export function __setJudgeClientForTests(c: TypeSafeClient | null): void {
  client = c;
}

export function isJudgeConfigured(): boolean {
  try {
    return !!env().TYPESAFE_API_KEY;
  } catch {
    return false;
  }
}

function getClient(): TypeSafeClient | null {
  if (client) return client; // injected in tests, or already created
  if (!isJudgeConfigured()) return null;
  try {
    client = new TypeSafeClient({
      apiKey: env().TYPESAFE_API_KEY,
      defaultModel: env().TYPESAFE_MODEL_ID,
    });
  } catch {
    return null;
  }
  return client;
}

const CALL_TIMEOUT_MS = 30_000;

// --- Thresholds (tuned starting points; see docs/judgments.md) --------------

export const INTENT_MIN_CONFIDENCE = 0.5;
export const RELEVANCE_MIN_SCORE = 0.35;
export const CITATION_AUTO_ACCEPT = 0.8;

// --- 1. Intent routing ------------------------------------------------------

export type Intent = "remember" | "recall";

export async function routeIntent(
  text: string,
): Promise<{ intent: Intent; confidence: number } | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const { answers, usage } = await c.systemOne(
      {
        state: text.slice(0, 2000),
        questions: {
          intent: choice("What does the user want to do?", {
            remember:
              "The user reports something that happened or someone they met — a note, meeting, call, or message to save to memory.",
            recall:
              "The user asks a question about people they know and expects an answer from memory.",
          }),
        },
      },
      { timeout: CALL_TIMEOUT_MS },
    );
    const a = answers.intent;
    log.info("judge_route", {
      intent: a.choice,
      confidence: a.confidence,
      inputTokens: usage.input_tokens,
    });
    return { intent: a.choice as Intent, confidence: a.confidence };
  } catch (err) {
    log.warn("judge_route_failed", { error: String(err) });
    return null;
  }
}

// --- 2. Person resolution (pre-parsed selection) ----------------------------

export const NO_MATCH = "none_of_these";

const NAME_CORE = "[A-ZÀ-Ý][a-zà-ÿ]+(?:\\s+[A-ZÀ-Ý][a-zà-ÿ]+)?";
const HONORIFIC = "(?:Dr\\.?|Mr\\.?|Ms\\.?|Mrs\\.?|Prof\\.?)\\s+";

/** Sentence starters that look like names but never are. */
const NAME_STOPLIST = new Set(
  "met coffee call dinner lunch meeting ran had talked spoke dm caught introduced chatted phone zoom email text the a an my i we they he she it this that what who when where how why just today yesterday tomorrow promisetold said".toLowerCase().split(/\s+/),
);

/**
 * Code-side candidate finder: recall-tuned name-span detection, deduped, in
 * document order. Over-finds on purpose — Jev picks the right one.
 */
export function findPersonSpans(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string | undefined) => {
    const span = (raw ?? "").replace(/\s+/g, " ").trim();
    if (!span) return;
    const key = span.toLowerCase();
    if (seen.has(key)) return;
    const first = span.split(" ")[0]?.toLowerCase() ?? "";
    if (NAME_STOPLIST.has(first)) return;
    seen.add(key);
    out.push(span);
  };

  // High precision: verb contexts ("Met X", "Coffee with X", "Ran into X").
  const verbRe = new RegExp(
    `\\b(?:met(?:\\s+with)?|talked to|spoke with|call with|coffee with|dinner with|lunch with|meeting with|dm'?d with|ran into|caught up with|introduced to|chatted with)\\s+((?:${HONORIFIC})?${NAME_CORE})`,
    "gi",
  );
  for (const m of text.matchAll(verbRe)) push(m[1]);

  // "X is/works/said/…" subjects.
  const subjRe = new RegExp(
    `\\b((?:${HONORIFIC})?${NAME_CORE})\\s+(?:is|was|works|said|mentioned|runs|leads|founded|started)`,
    "g",
  );
  for (const m of text.matchAll(subjRe)) push(m[1]);

  // Extra recall: capitalized bigrams anywhere (skip sentence-initial word).
  const biRe = new RegExp(`\\b${NAME_CORE}\\b`, "g");
  for (const m of text.matchAll(biRe)) {
    const span = m[0];
    if (!span.includes(" ")) continue;
    const idx = m.index ?? 0;
    // Skip if it starts the text or follows a sentence boundary.
    const before = text.slice(Math.max(0, idx - 3), idx);
    if (idx === 0 || /[.!?]\s*$/.test(before)) continue;
    push(span);
  }
  return out;
}

/**
 * Pick which person a memory is primarily about.
 *
 * Candidates MUST be pre-parsed by code: existing roster names + name-like
 * spans detected in the text. The answer is always one of those spans copied
 * verbatim (or the none hatch) — Jev cannot invent a name.
 */
export async function resolvePersonName(
  text: string,
  candidates: string[],
): Promise<{ name: string | null; confidence: number } | null> {
  const c = getClient();
  if (!c) return null;
  const seen = new Set<string>();
  const options = candidates
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
    .slice(0, 60);
  if (options.length === 0) return null;
  const criteria: Record<string, string | null> = {};
  for (const o of options) criteria[o] = null;
  criteria[NO_MATCH] =
    "The memory is not primarily about any listed person (no identifiable person, or someone not listed).";
  try {
    const { answers, usage } = await c.systemOne(
      {
        state: text.slice(0, 2000),
        questions: {
          person: choice(
            "Which person is this memory primarily about — the person the user met, spoke with, or is reporting on? Do NOT pick someone who is merely mentioned for an intro, referral, or comparison.",
            criteria,
          ),
        },
      },
      { timeout: CALL_TIMEOUT_MS },
    );
    const a = answers.person;
    log.info("judge_person", {
      choice: a.choice,
      confidence: a.confidence,
      candidates: options.length,
      inputTokens: usage.input_tokens,
    });
    if (a.choice === NO_MATCH) return { name: null, confidence: a.confidence };
    return { name: a.choice, confidence: a.confidence };
  } catch (err) {
    log.warn("judge_person_failed", { error: String(err) });
    return null;
  }
}

// --- 3. Relevance ranking (one batched call) ---------------------------------

export interface ScoredCandidate {
  id: string;
  score: number;
}

/**
 * Score each candidate memory against the question — one systemOne call with
 * one Noul per pair, sorted highest-first. This replaces the generative
 * reranker: calibrated probabilities instead of a parsed index list.
 */
export async function scoreRelevance(
  question: string,
  candidates: { id: string; text: string }[],
): Promise<ScoredCandidate[] | null> {
  const c = getClient();
  if (!c) return null;
  const pool = candidates.slice(0, 12);
  if (pool.length === 0) return [];
  const questions: Record<string, ReturnType<typeof noul>> = {};
  pool.forEach((_m, i) => {
    questions[`rel_${i}`] = noul(
      `Consider ONLY the memory at \`memories[${i}]\`. Does that memory answer the question at \`question\`, or identify a person the question asks about? A memory that merely mentions a related topic without answering does NOT count.`,
    );
  });
  try {
    const { answers, usage } = await c.systemOne(
      {
        state: {
          question: question.slice(0, 1000),
          memories: pool.map((m, i) => ({ key: `rel_${i}`, text: m.text.slice(0, 800) })),
        },
        questions,
      },
      { timeout: CALL_TIMEOUT_MS },
    );
    const scored = pool.map((m, i) => ({
      id: m.id,
      score: (answers[`rel_${i}`]?.noul ?? 0) as number,
    }));
    scored.sort((a, b) => b.score - a.score);
    log.info("judge_rerank", {
      candidates: pool.length,
      top: scored[0]?.score ?? null,
      inputTokens: usage.input_tokens,
    });
    return scored;
  } catch (err) {
    log.warn("judge_rerank_failed", { error: String(err) });
    return null;
  }
}

// --- 4. Citation verification (one batched call) ------------------------------

export type CitationVerdict = "verified" | "contradicted" | "unsupported";

export async function verifyCitations(
  items: { id: string; claim: string; source: string }[],
): Promise<Record<string, { verdict: CitationVerdict; confidence: number }> | null> {
  const c = getClient();
  if (!c || items.length === 0) return items.length === 0 ? {} : null;
  const pool = items.slice(0, 8);
  const questions: Record<string, ReturnType<typeof choice>> = {};
  pool.forEach((_item, i) => {
    questions[`cite_${i}`] = choice(
      `Consider ONLY the pair at \`pairs[${i}]\`. How does its source text relate to its claim?`,
      {
        supports: "The source states the claim or directly implies it is true.",
        contradicts: "The source states the opposite or implies the claim is false.",
        says_nothing:
          "The source does not address what the claim asserts, either way.",
      },
    );
  });
  try {
    const { answers, usage } = await c.systemOne(
      {
        state: {
          pairs: pool.map((item, i) => ({
            key: `cite_${i}`,
            claim: item.claim.slice(0, 600),
            source: item.source.slice(0, 1200),
          })),
        },
        questions,
      },
      { timeout: CALL_TIMEOUT_MS },
    );
    const out: Record<string, { verdict: CitationVerdict; confidence: number }> = {};
    pool.forEach((item, i) => {
      const a = answers[`cite_${i}`];
      const verdict =
        a?.choice === "supports"
          ? "verified"
          : a?.choice === "contradicts"
            ? "contradicted"
            : "unsupported";
      out[item.id] = { verdict, confidence: a?.confidence ?? 0 };
    });
    log.info("judge_citations", {
      checked: pool.length,
      verified: Object.values(out).filter((v) => v.verdict === "verified").length,
      inputTokens: usage.input_tokens,
    });
    return out;
  } catch (err) {
    log.warn("judge_citations_failed", { error: String(err) });
    return null;
  }
}
