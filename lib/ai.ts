import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import { env, useMockAI } from "./env";
import type { ExtractedMemory, MemoryKind } from "./types";

/**
 * The AI layer. Three capabilities:
 *   1. extractMemory  — turn raw user text into a structured person + facts + commitments
 *   2. embed          — produce an embedding vector for semantic recall
 *   3. synthesizeRecall — answer a question grounded ONLY in retrieved memories
 *
 * Chat uses the Bedrock Mantle endpoint (OpenAI-compatible Chat Completions),
 * authenticated with a single Bedrock API key — the simplest auth path.
 * Embeddings use Amazon Titan via the native bedrock-runtime API, which
 * requires IAM access keys; without them we fall back to a deterministic local
 * hash embedding (documented, never silently faked). If no Bedrock auth is
 * configured at all (or AI_PROVIDER=mock), everything uses the deterministic
 * local implementation so the product stays fully runnable for local dev.
 */

const REQUEST_TIMEOUT_MS = 60_000;

// --- Bedrock Mantle: OpenAI-compatible Chat Completions -------------------

async function chatJSON(system: string, user: string): Promise<string> {
  const e = env();
  const res = await fetch(
    `https://bedrock-mantle.${e.AWS_REGION}.api.aws/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${e.BEDROCK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: e.BEDROCK_TEXT_MODEL_ID,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 1024,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Bedrock ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = await res.json();
  return (json?.choices?.[0]?.message?.content ?? "").trim();
}

// --- Bedrock: Titan embeddings (needs IAM credentials) --------------------

let _client: BedrockRuntimeClient | null = null;
function bedrock(): BedrockRuntimeClient {
  if (!_client) {
    const e = env();
    _client = new BedrockRuntimeClient({
      region: e.AWS_REGION,
      credentials: {
        accessKeyId: e.AWS_ACCESS_KEY_ID!,
        secretAccessKey: e.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }
  return _client;
}

// --- Bedrock: Titan embeddings --------------------------------------------

async function titanEmbed(text: string): Promise<number[]> {
  const e = env();
  const cmd = new InvokeModelCommand({
    modelId: e.BEDROCK_EMBED_MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({ inputText: text, dimensions: e.EMBED_DIMENSIONS }),
  });
  const res = await bedrock().send(cmd);
  const decoded = JSON.parse(new TextDecoder().decode(res.body));
  const embedding: number[] = decoded?.embedding ?? [];
  return embedding;
}

// --- Schemas for validating model output ----------------------------------

const extractionSchema = z.object({
  personName: z.string().nullable(),
  headline: z.string().nullable(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  kind: z.enum(["note", "meeting", "message", "call"]),
  facts: z.array(z.object({ attribute: z.string(), value: z.string() })),
  commitments: z.array(
    z.object({
      description: z.string(),
      dueInDays: z.number().nullable(),
    }),
  ),
});

function safeParseJSON(raw: string): unknown {
  // Models sometimes wrap JSON in prose or fences. Extract the first {...}.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

const EXTRACT_SYSTEM = `You extract structured relationship memory from a user's note about a person they met or interacted with.
Return ONLY a JSON object with this exact shape:
{
  "personName": string | null,       // the OTHER person's name (not the user)
  "headline": string | null,         // short role/summary e.g. "Founder @ Acme, ex-Stripe"
  "company": string | null,
  "location": string | null,
  "kind": "note" | "meeting" | "message" | "call",
  "facts": [ { "attribute": string, "value": string } ],   // durable facts: role, interests, family, preferences, hiring needs, etc.
  "commitments": [ { "description": string, "dueInDays": number | null } ]  // follow-ups the USER should do; dueInDays = when, or null
}
Rules:
- Extract only what is stated or clearly implied. Do NOT invent facts.
- attributes should be short snake_case keys (e.g. "role", "interest", "hiring_for", "kid_name").
- If no person is identifiable, personName is null.
- Output JSON only, no prose.`;

// --- Public API -----------------------------------------------------------

export async function extractMemory(text: string): Promise<ExtractedMemory> {
  if (useMockAI()) return mockExtract(text);
  try {
    const raw = await chatJSON(EXTRACT_SYSTEM, text);
    const parsed = extractionSchema.safeParse(safeParseJSON(raw));
    if (parsed.success) return parsed.data;
    // Model returned unexpected shape — fall back to a minimal capture so we
    // NEVER lose the user's raw memory.
    return degradedExtract(text);
  } catch (err) {
    console.error("[ai] extractMemory failed, degrading:", errMsg(err));
    return degradedExtract(text);
  }
}

export async function embed(text: string): Promise<number[]> {
  const e = env();
  // Titan embeddings run on bedrock-runtime and need IAM credentials; a
  // Bedrock API key alone cannot embed, so fall back to the deterministic
  // local embedding in that case.
  if (useMockAI() || !e.AWS_ACCESS_KEY_ID || !e.AWS_SECRET_ACCESS_KEY) {
    return mockEmbed(text, e.EMBED_DIMENSIONS);
  }
  try {
    const v = await titanEmbed(text);
    if (v.length === e.EMBED_DIMENSIONS) return v;
    console.error(
      `[ai] embedding dim ${v.length} != ${e.EMBED_DIMENSIONS}, using mock`,
    );
    return mockEmbed(text, e.EMBED_DIMENSIONS);
  } catch (err) {
    // Bedrock-runtime (and so Titan embeddings) is often blocked by the AWS
    // account while the Mantle chat endpoint remains available. Explain it so
    // the fallback is never mistaken for a bug.
    console.error(
      "[ai] embed failed, degrading to local hash embedding:",
      errMsg(err),
      "| Real Titan embeddings need bedrock:InvokeModel on",
      e.BEDROCK_EMBED_MODEL_ID,
      "(enable it in Bedrock Model access + IAM)",
    );
    return mockEmbed(text, e.EMBED_DIMENSIONS);
  }
}

const RECALL_SYSTEM = `You are the user's relationship memory. Answer the user's question using ONLY the provided memories.
- Be concise and specific.
- If the memories do not contain the answer, say "I don't have a memory of that yet." Do NOT guess or invent.
- Refer to people by name. Do not mention memory IDs.`;

export async function synthesizeRecall(
  question: string,
  memories: { id: string; personName: string | null; content: string; occurredAt: string }[],
): Promise<string> {
  if (memories.length === 0) {
    return "I don't have a memory of that yet.";
  }
  if (useMockAI()) return mockRecall(question, memories);
  try {
    const context = memories
      .map(
        (m, i) =>
          `[#${i + 1}] (${m.personName ?? "unknown"}, ${m.occurredAt}): ${m.content}`,
      )
      .join("\n");
    const user = `Memories:\n${context}\n\nQuestion: ${question}`;
    const answer = await chatJSON(RECALL_SYSTEM, user);
    return answer.trim() || mockRecall(question, memories);
  } catch (err) {
    console.error("[ai] synthesizeRecall failed, degrading:", errMsg(err));
    return mockRecall(question, memories);
  }
}

// --- Deterministic mock implementations (local dev / no AWS) ---------------

function mockExtract(text: string): ExtractedMemory {
  // Optional honorific (Dr./Mr./Ms./Mrs./Prof.) + one or two capitalized names.
  // Supports accented letters (e.g. "Tomás Silva").
  const NAME = "((?:Dr\\.?|Mr\\.?|Ms\\.?|Mrs\\.?|Prof\\.?)?\\s*[A-ZÀ-Ý][a-zà-ÿ]+(?:\\s+[A-ZÀ-Ý][a-zà-ÿ]+)?)";
  const nameMatch =
    // "Met/Coffee with/Call with/Dinner with/DM'd with/Ran into/Talked to X"
    text.match(
      new RegExp(
        `\\b(?:met(?:\\s+with)?|met with|talked to|spoke with|call with|coffee with|dinner with|lunch with|meeting with|dm'?d with|ran into|caught up with|introduced to|chatted with)\\s+${NAME}`,
        "i",
      ),
    ) ??
    // "X is/works/said/mentioned/runs/leads…"
    text.match(
      new RegExp(`\\b${NAME}\\s+(?:is|was|works|said|mentioned|runs|leads|founded|started)`),
    );
  const personName = nameMatch?.[1]?.replace(/\s+/g, " ").trim() ?? null;

  const companyMatch = text.match(/\b(?:at|@)\s+([A-Z][A-Za-z0-9&.\- ]{1,30})/);
  const kind: MemoryKind = /\bcall\b/i.test(text)
    ? "call"
    : /\bmet|meeting\b/i.test(text)
      ? "meeting"
      : /\b(dm|message|texted|emailed)\b/i.test(text)
        ? "message"
        : "note";

  const facts: { attribute: string; value: string }[] = [];
  const hiring = text.match(/hiring\s+(?:for\s+)?([A-Za-z0-9 ,\-]{3,40})/i);
  if (hiring?.[1]) facts.push({ attribute: "hiring_for", value: hiring[1].trim() });
  const interest = text.match(/(?:into|interested in|likes|loves)\s+([A-Za-z0-9 ,\-]{3,40})/i);
  if (interest?.[1]) facts.push({ attribute: "interest", value: interest[1].trim() });

  const commitments: { description: string; dueInDays: number | null }[] = [];
  const promise = text.match(/(?:promised|said i'?d|need to|should|will|follow up)\s+([A-Za-z0-9 ,'\-]{4,60})/i);
  if (promise?.[1]) commitments.push({ description: promise[1].trim(), dueInDays: 3 });

  const company = companyMatch?.[1]?.trim() ?? null;
  return {
    personName,
    headline: company ? `at ${company}` : null,
    company,
    location: null,
    kind,
    facts,
    commitments,
  };
}

/** Minimal, never-lose-data extraction when the model output can't be parsed. */
function degradedExtract(text: string): ExtractedMemory {
  const mock = mockExtract(text);
  return { ...mock, facts: mock.facts, commitments: mock.commitments };
}

/**
 * Deterministic pseudo-embedding: hashes tokens into a fixed-dim vector and
 * L2-normalizes. Good enough for local semantic-ish recall in the demo; the
 * real path uses Titan. Same text always yields the same vector.
 */
function mockEmbed(text: string, dim: number): number[] {
  const vec = new Array<number>(dim).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dim;
    vec[idx] = (vec[idx] ?? 0) + 1;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

function mockRecall(
  question: string,
  memories: { personName: string | null; content: string }[],
): string {
  const top = memories.slice(0, 3);
  const names = Array.from(
    new Set(top.map((m) => m.personName).filter(Boolean)),
  ).join(", ");
  const lead = names ? `Based on what you told me about ${names}: ` : "";
  return `${lead}${top.map((m) => m.content).join(" ")}`.slice(0, 600);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
