import { query, queryOne, withTransaction, toVectorLiteral } from "./db";
import { extractMemory, embed, synthesizeRecall } from "./ai";
import type {
  Commitment,
  Fact,
  Memory,
  Person,
  RecallAnswer,
  RecallCitation,
  TodayItem,
} from "./types";

/**
 * Memory domain service — the product logic that turns raw user text into
 * durable, queryable memory and answers questions from it.
 *
 * Everything here is scoped by userId. Callers MUST pass the authenticated
 * user's id; there is no cross-user access path.
 */

const MAX_INPUT_CHARS = 4000;

export interface CaptureResult {
  memory: Memory;
  person: Person | null;
  factsAdded: number;
  commitmentsAdded: number;
  summary: string;
}

/**
 * Capture a memory from raw user text:
 *  1. extract structured data (Bedrock)
 *  2. resolve/create the person
 *  3. store raw memory + embedding + facts + commitments — in ONE transaction
 *
 * The raw memory is always saved even if extraction is thin, so we never lose
 * what the user told us.
 */
export async function captureMemory(
  userId: string,
  rawText: string,
): Promise<CaptureResult> {
  const text = rawText.trim().slice(0, MAX_INPUT_CHARS);
  if (!text) throw new Error("Empty memory");

  const extracted = await extractMemory(text);
  const embedding = await embed(text);
  const vectorLiteral = toVectorLiteral(embedding);

  return await withTransaction(async (client) => {
    // 1. Resolve or create the person (if one was identified).
    let person: Person | null = null;
    if (extracted.personName) {
      const found = await client.query<Person>(
        `SELECT * FROM person WHERE user_id = $1 AND lower(name) = lower($2) LIMIT 1`,
        [userId, extracted.personName],
      );
      if (found.rows[0]) {
        person = found.rows[0];
        // Enrich sparse fields without overwriting existing values.
        await client.query(
          `UPDATE person
             SET headline = COALESCE(headline, $2),
                 company  = COALESCE(company, $3),
                 location = COALESCE(location, $4),
                 last_interaction_at = now(),
                 updated_at = now()
           WHERE id = $1`,
          [person.id, extracted.headline, extracted.company, extracted.location],
        );
      } else {
        const created = await client.query<Person>(
          `INSERT INTO person (user_id, name, headline, company, location, last_interaction_at)
           VALUES ($1, $2, $3, $4, $5, now())
           RETURNING *`,
          [
            userId,
            extracted.personName,
            extracted.headline,
            extracted.company,
            extracted.location,
          ],
        );
        person = created.rows[0] ?? null;
      }
    }

    // 2. Store the raw memory (source of truth).
    const memRows = await client.query<Memory>(
      `INSERT INTO memory (user_id, person_id, kind, content)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, person?.id ?? null, extracted.kind, text],
    );
    const memory = memRows.rows[0];
    if (!memory) throw new Error("Failed to store memory");

    // 3. Store the embedding (semantic recall) — same transaction = no drift.
    await client.query(
      `INSERT INTO memory_embedding (memory_id, user_id, embedding)
       VALUES ($1, $2, $3::vector)`,
      [memory.id, userId, vectorLiteral],
    );

    // 4. Store derived facts (each cites this memory).
    let factsAdded = 0;
    if (person) {
      for (const f of extracted.facts) {
        await client.query(
          `INSERT INTO fact (user_id, person_id, attribute, value, source_memory_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, person.id, f.attribute, f.value, memory.id],
        );
        factsAdded++;
      }
    }

    // 5. Store commitments / follow-ups (drive the Today feed).
    let commitmentsAdded = 0;
    for (const c of extracted.commitments) {
      const dueClause =
        c.dueInDays === null
          ? null
          : new Date(Date.now() + c.dueInDays * 86400_000).toISOString();
      await client.query(
        `INSERT INTO commitment (user_id, person_id, description, due_at, source_memory_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, person?.id ?? null, c.description, dueClause, memory.id],
      );
      commitmentsAdded++;
    }

    await client.query(
      `INSERT INTO audit_log (user_id, action, detail)
       VALUES ($1, 'capture_memory', $2)`,
      [
        userId,
        JSON.stringify({
          memoryId: memory.id,
          personId: person?.id ?? null,
          factsAdded,
          commitmentsAdded,
        }),
      ],
    );

    const summary = buildCaptureSummary(person, factsAdded, commitmentsAdded);
    return { memory, person, factsAdded, commitmentsAdded, summary };
  });
}

function buildCaptureSummary(
  person: Person | null,
  facts: number,
  commitments: number,
): string {
  const who = person ? person.name : "this";
  const bits: string[] = [`Got it — saved to your memory of ${who}.`];
  if (facts > 0) bits.push(`${facts} detail${facts > 1 ? "s" : ""} remembered.`);
  if (commitments > 0)
    bits.push(
      `${commitments} follow-up${commitments > 1 ? "s" : ""} added to Today.`,
    );
  return bits.join(" ");
}

/**
 * Hybrid recall: semantic KNN over embeddings + relational join to people,
 * scoped to the user. Returns a synthesized answer plus citations to the
 * exact memories that support it (trustworthy, never invented).
 */
export async function recall(
  userId: string,
  question: string,
  limit = 6,
): Promise<RecallAnswer> {
  const q = question.trim().slice(0, MAX_INPUT_CHARS);
  if (!q) return { answer: "Ask me anything about the people you've met.", citations: [] };

  const embedding = await embed(q);
  const vectorLiteral = toVectorLiteral(embedding);

  // The core query: vector similarity (<-> = L2 distance) + relational join,
  // all in one CockroachDB statement, all scoped by user_id.
  const rows = await query<{
    memory_id: string;
    person_id: string | null;
    person_name: string | null;
    content: string;
    occurred_at: string;
    distance: number;
  }>(
    `SELECT m.id AS memory_id,
            m.person_id,
            p.name AS person_name,
            m.content,
            m.occurred_at,
            (me.embedding <-> $2::vector) AS distance
       FROM memory_embedding me
       JOIN memory m ON m.id = me.memory_id
       LEFT JOIN person p ON p.id = m.person_id
      WHERE me.user_id = $1
      ORDER BY me.embedding <-> $2::vector
      LIMIT $3`,
    [userId, vectorLiteral, limit],
  );

  const citations: RecallCitation[] = rows.map((r) => ({
    memoryId: r.memory_id,
    personId: r.person_id,
    personName: r.person_name,
    snippet: r.content.slice(0, 240),
    occurredAt: r.occurred_at,
    // Convert distance to a friendly 0..1 relevance score.
    score: Number((1 / (1 + Number(r.distance))).toFixed(3)),
  }));

  const answer = await synthesizeRecall(
    q,
    rows.map((r) => ({
      id: r.memory_id,
      personName: r.person_name,
      content: r.content,
      occurredAt: r.occurred_at,
    })),
  );

  return { answer, citations };
}

// --- People & profiles -----------------------------------------------------

export async function listPeople(userId: string): Promise<Person[]> {
  return await query<Person>(
    `SELECT * FROM person WHERE user_id = $1 ORDER BY last_interaction_at DESC NULLS LAST, name ASC`,
    [userId],
  );
}

export async function getPerson(
  userId: string,
  personId: string,
): Promise<Person | null> {
  return await queryOne<Person>(
    `SELECT * FROM person WHERE id = $1 AND user_id = $2`,
    [personId, userId],
  );
}

export async function getPersonFacts(
  userId: string,
  personId: string,
): Promise<Fact[]> {
  return await query<Fact>(
    `SELECT * FROM fact WHERE user_id = $1 AND person_id = $2 ORDER BY created_at DESC`,
    [userId, personId],
  );
}

export async function getPersonMemories(
  userId: string,
  personId: string,
): Promise<Memory[]> {
  return await query<Memory>(
    `SELECT * FROM memory WHERE user_id = $1 AND person_id = $2 ORDER BY occurred_at DESC`,
    [userId, personId],
  );
}

// --- Today feed & commitments ---------------------------------------------

/**
 * Build the "Today" feed: open commitments that are due/overdue, plus stale
 * relationships (no interaction in 30+ days). Ordered by urgency.
 */
export async function getTodayFeed(userId: string): Promise<TodayItem[]> {
  const dueRows = await query<Commitment & { person_name: string | null }>(
    `SELECT c.*, p.name AS person_name
       FROM commitment c
       LEFT JOIN person p ON p.id = c.person_id
      WHERE c.user_id = $1
        AND c.status = 'open'
        AND (c.due_at IS NULL OR c.due_at <= now() + INTERVAL '1 day')
      ORDER BY c.due_at ASC NULLS LAST
      LIMIT 50`,
    [userId],
  );

  const items: TodayItem[] = dueRows.map((c) => {
    const overdue = c.due_at ? new Date(c.due_at).getTime() < Date.now() : false;
    return {
      commitment: c,
      personName: c.person_name,
      reason: overdue ? "overdue" : "due",
      draftMessage: buildDraft(c.person_name, c.description),
    };
  });

  return items;
}

function buildDraft(personName: string | null, description: string): string {
  const hi = personName ? `Hi ${personName},` : "Hi,";
  return `${hi} following up on ${description}. Would love to reconnect — do you have time this week?`;
}

export async function updateCommitmentStatus(
  userId: string,
  commitmentId: string,
  status: "done" | "snoozed" | "dismissed",
): Promise<void> {
  const snoozeClause = status === "snoozed" ? `, due_at = now() + INTERVAL '3 days'` : "";
  const resetStatus = status === "snoozed" ? "open" : status;
  await query(
    `UPDATE commitment
        SET status = $3, updated_at = now()${snoozeClause}
      WHERE id = $1 AND user_id = $2`,
    [commitmentId, userId, resetStatus],
  );
  await query(
    `INSERT INTO audit_log (user_id, action, detail) VALUES ($1, 'commitment_status', $2)`,
    [userId, JSON.stringify({ commitmentId, status })],
  );
}

export async function recentMemories(
  userId: string,
  limit = 20,
): Promise<(Memory & { person_name: string | null })[]> {
  return await query<Memory & { person_name: string | null }>(
    `SELECT m.*, p.name AS person_name
       FROM memory m
       LEFT JOIN person p ON p.id = m.person_id
      WHERE m.user_id = $1
      ORDER BY m.occurred_at DESC
      LIMIT $2`,
    [userId, limit],
  );
}
