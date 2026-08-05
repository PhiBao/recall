# 🪳 Recall — Remember Every Person

**Recall is a relationship-memory agent.** You tell it, in plain words, about the
people you meet ("Met Sarah at the AI meetup, she's hiring React devs, I promised
to intro her to Priya"). Recall extracts the person, the durable facts, and the
follow-ups you owe — then lets you **ask questions in natural language** and get
answers grounded in the *exact* memories they came from. It also builds a daily
**"Today" feed** so relationships never quietly go cold.

Built for the **CockroachDB AI Hackathon**. Recall's thesis: an AI that helps you
remember people is only useful if its memory is **durable, consistent, and
trustworthy**. That is precisely a database problem — and it's why the whole
thing runs on **one CockroachDB cluster** that stores *both* the structured
relational memory *and* the semantic vector memory, with **no second vector
store to keep in sync**.

---

## Why this is a real product (not a dashboard)

- **User problem:** People with large networks (founders, salespeople, recruiters,
  investors, community builders) forget names, context, and promises. Existing
  CRMs are heavy data-entry tools; note apps don't *recall*. The pain is frequent,
  emotionally charged (embarrassment, lost deals), and poorly served.
- **The wedge:** capture is *conversational* (one sentence), recall is *cited*
  (never invented), and follow-up is *proactive* (a daily nudge). No forms, no
  pipeline stages, no admin panel.
- **The moat is the memory:** value compounds the more you tell it, and correctness
  depends on a store that is strongly consistent and never drifts — CockroachDB.

---

## How CockroachDB is used (the core of the entry)

Recall puts **relational rows and vector embeddings in the same transactional
database**, and exposes that memory layer to *two* agents. This entry uses
**two CockroachDB AI tools**:

### 1. Distributed Vector Indexing — the memory engine

- `person`, `memory`, `fact`, `commitment` — normalized relational data.
- `memory_embedding` uses the native **`VECTOR(1024)` type** with a
  **`CREATE VECTOR INDEX`** (CockroachDB Distributed Vector Index) for fast
  semantic KNN.
- **Capture is one transaction:** the raw memory, its embedding, extracted facts,
  and commitments are written together. If anything fails, it all rolls back —
  so the vector index and the relational facts can **never drift out of sync**
  (the classic Postgres + Pinecone failure mode).
- **Recall is one query:** semantic similarity (`embedding <-> $query`) is joined
  to `person`/`memory` and filtered by `user_id` in a single SQL statement —
  hybrid vector + relational retrieval, strongly consistent, on one engine.

Every recall answer returns **citations** to the source memory rows, so the
answer is auditable and never fabricated.

### 2. Managed MCP Server — the ops agent

The **CockroachDB Cloud Managed MCP Server** (`https://cockroachlabs.cloud/mcp`)
connects a *second* AI agent (Claude Code, Cursor, VS Code) directly to the
cluster — **read-only by default, fully audited, zero custom proxy**. This ops
agent *inspects* the memory engine: querying the audit log, checking data
health, surfacing insights about the user's network. It can never modify data.

Two agents, one memory layer — that's the production-grade architecture the
hackathon is asking for. See **[docs/ops-agent.md](docs/ops-agent.md)** for the
setup, example queries, and the demo script.

---

## AWS Bedrock

- **Extraction & recall synthesis:** Amazon Bedrock **Mantle** endpoint
  (OpenAI-compatible Chat Completions) authenticated with a single **Bedrock
  API key**. Default model is Voxtral Mini 3B — the cheapest model that reliably
  produces the structured-extraction JSON. Answers questions **only** from
  retrieved memories (grounded, with a strict "I don't have a memory of that
  yet" fallback — no hallucinated relationships).
- **Embeddings:** Amazon Titan Text Embeddings v2 (1024-dim) → stored in the
  CockroachDB vector index. Requires IAM access keys (the API key alone can't
  call the embeddings API); without them Recall uses a deterministic local
  hash embedding so semantic recall still works.

> **No AWS credentials? It still runs.** Set `AI_PROVIDER=mock` (or just leave
> the Bedrock API key / access keys blank) and Recall uses a deterministic local
> extractor + hash embedding so you can run the full product and demo
> end-to-end. The real Bedrock path is used automatically when auth is present.

---

## Architecture

```
app/                     Next.js 15 App Router (React 19, server components)
  page.tsx               Landing + passwordless sign-in
  app/page.tsx           Main workspace: Composer + Today feed + People
  app/person/[id]/       Person profile: facts + memory timeline
  actions.ts             Server actions (only write path; auth-scoped)
components/
  Composer.tsx           One box, two intents: "Remember" / "Recall" (cited)
  TodayCard.tsx          Follow-up card: Done / Snooze / copy draft
lib/
  schema.sql             CockroachDB schema incl. VECTOR INDEX
  db.ts                  Pooled, parameterized SQL + transaction helper
  ai.ts                  Bedrock Mantle (Voxtral Mini) + Titan with deterministic fallback
  memory.ts              Domain logic: captureMemory() + recall() (hybrid query)
  auth.ts                Signed httpOnly session; strict per-user isolation
  env.ts                 Zod-validated, fail-fast config
scripts/
  migrate.ts             Apply schema        (pnpm db:migrate)
  seed.ts                Seed demo memories  (pnpm db:seed)
  run-nudges.ts          Daily reconnect nudges (pnpm nudge:run)
  verify-embeddings.ts   Prove real Titan path  (pnpm embed:verify)
  reseed-embeddings.ts   Regenerate vectors    (pnpm db:seed-embeddings)
docs/
  ops-agent.md           MCP Server ops-agent workflow + demo script
  embedding-fix.md       Enabling real Titan embeddings
```

### Two agents, one memory layer

```
 ┌──────────────┐        capture / recall         ┌─────────────────────────┐
 │  Recall UI   │ ──────────────────────────────► │                         │
 │  (Next.js)   │ ◄────────────────────────────── │     CockroachDB Cloud   │
 └──────────────┘        cited answers            │                         │
                                                  │  person / memory / fact │
 ┌──────────────┐   read-only, audited queries    │  commitment / audit_log │
 │  Ops Agent   │ ──────────────────────────────► │  memory_embedding       │
 │ (Claude/     │ ◄────────────────────────────── │    (VECTOR + vec index) │
 │  Cursor via  │        insights                 │                         │
 │  MCP Server) │                                 └─────────────────────────┘
 └──────────────┘                                             │
                                                              │ embeddings
                                                              ▼
                                                       ┌─────────────┐
                                                       │ AWS Bedrock │
                                                       │ (Titan v2)  │
                                                       └─────────────┘
```

---

## Getting started

### 1. Prerequisites
- Node ≥ 20 (tested on 22), `pnpm`
- A CockroachDB cluster **v24.3+** (required for vector indexing).
  - Free option: [CockroachDB Cloud Serverless](https://cockroachlabs.cloud/).
  - Local: `cockroach start-single-node --insecure` then
    `cockroach sql --insecure -e "CREATE DATABASE recall;"`

### 2. Configure
```bash
cp .env.example .env.local
# set DATABASE_URL, AUTH_SECRET (openssl rand -base64 48)
# optional: Bedrock API key (or IAM access keys) — or set AI_PROVIDER=mock to run without
```

### 3. Install, migrate, seed
```bash
pnpm install
pnpm db:migrate      # creates tables + VECTOR INDEX
pnpm db:seed         # optional: demo user with realistic memories
```

### 4. Run
```bash
pnpm dev             # http://localhost:3000
```
Sign in with any email (passwordless — a private memory space is created
instantly). If you seeded, sign in as **`demo@recall.app`**.

---

## Try it (90-second demo script)

1. **Remember:** paste
   *"Met Sarah Chen at the AI meetup — founder at Nimbus, ex-Stripe, hiring senior
   React engineers. Promised to intro her to Priya."*
   → Recall confirms what it saved and adds the follow-up to **Today**.
2. Add two more people the same way.
3. **Recall:** switch to the *Recall* tab and ask
   *"Who did I meet that's hiring React engineers?"*
   → You get a natural-language answer **plus the exact memory it came from**
   (click the name to open the person's profile + timeline).
4. **Follow through:** in the **Today** panel, hit *Done* / *Snooze*, or copy the
   pre-drafted reconnect message.

---

## Security & privacy

Security is treated as an engineering requirement:

- **Per-user isolation:** every query is scoped by the authenticated `user_id`;
  there is no cross-user read/write path. Server actions resolve the user before
  any data access.
- **Parameterized SQL everywhere** (`$1, $2 …`) — no string interpolation, no SQL
  injection surface. Inputs validated with Zod and length-capped.
- **Sessions** are signed (HS256, `jose`), `httpOnly`, `sameSite=lax`, `secure`
  in production.
- **Grounded AI:** recall answers are constrained to retrieved memories and cite
  their sources; the model is instructed never to invent relationships.
- **Audit log:** captures and status changes are recorded in `audit_log`.
- **Rate limiting:** capture and recall are bounded per user (token bucket,
  30 req/min) so a runaway client can't exhaust Bedrock quota or spam the DB.
- **Structured logging:** every sign-in, capture, recall, and status change
  emits one JSON line (`lib/log.ts`) with the user id and outcome — ready for
  CloudWatch Logs indexing, no prose parsing.
- **Fail-fast config:** `lib/env.ts` validates env at startup so misconfiguration
  can't silently ship.

**MVP non-goals (documented, not accidental):** email magic-link *verification*
is stubbed (sign-in issues a session directly) for a frictionless demo; add a
one-time-link step before production. Per-field encryption at rest is future
work.

---

## AWS services used

- **Amazon Bedrock — Mantle endpoint** (Chat Completions): powers memory
  extraction and recall synthesis via Voxtral Mini 3B, authenticated with a
  Bedrock API key. Answers are grounded only in retrieved memories.
- **Amazon Bedrock — Titan Text Embeddings v2**: produces the 1024-dim vectors
  stored in the CockroachDB vector index. Requires IAM access keys.
- **AWS Amplify Hosting**: deploys the Next.js app from the GitHub repo
  (no Docker/ECR) and serves the live demo URL — see
  `docs/deploy-amplify.md`.
- **AWS Lambda + EventBridge** *(optional)*: runs the daily nudge cron
  serverlessly (see `infra/nudge-lambda.ts`). The proactive "Today" feed is an
  agent that acts without being asked.

> The required AWS category (Bedrock) is met, and the app is deployed on AWS
> via Amplify Hosting so judges get a live URL.

## Tech
Next.js 15 · React 19 · TypeScript (strict) · Tailwind · CockroachDB (relational +
distributed vector index · managed MCP Server) · AWS Bedrock (Mantle + Titan) ·
AWS Lambda · AWS Amplify Hosting · `pg` · `jose` · Zod.

## License
MIT — see [LICENSE](./LICENSE).
