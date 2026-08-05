# Video production script (< 3 minutes)

The hackathon requires a public video (YouTube or Vimeo) demonstrating the
submission **and the CockroachDB memory layer at work**. This script is timed
to ~2:45 so there's room for imperfection. Record the screen at 1080p; narrate
as you go.

## Pre-recording checklist

- [ ] Real Titan embeddings enabled and verified (`pnpm embed:verify` → PASS).
- [ ] Embeddings re-seeded (`pnpm db:seed-embeddings`).
- [ ] Demo data seeded (`pnpm db:seed`).
- [ ] App deployed on App Runner (or `pnpm dev` locally — but a live AWS URL is
      stronger).
- [ ] MCP server enabled in the Cloud Console for the ops-agent segment.
- [ ] A Claude Code / Cursor window open for the MCP segment.

## The script

### 0:00–0:15 — Hook
> "Agents that think, act, and remember. This is Recall — a relationship-memory
> agent where memory is a database problem. Everything runs on one CockroachDB
> cluster that stores *both* your structured relationships and their semantic
> vector embeddings, with no second vector store to keep in sync."

Show: the landing page, sign in as `demo@recall.app`.

### 0:15–0:45 — Capture
> "Tell it who you met, in plain words. Watch what it extracts."

Paste: *"Met Sarah Chen at the AI meetup — founder at Nimbus, ex-Stripe, hiring
senior React engineers. Promised to intro her to Priya."*

> "It extracted the person, the facts, the commitment — and the follow-up just
> landed in the Today feed. All of that was written in **one transaction**: raw
 memory, embedding, facts, commitments. Nothing can drift."

Show: the capture confirmation, then the Today card that appeared.

### 0:45–1:30 — Recall (the semantic moment)
> "Now the real test. I'm going to ask a question that uses *none* of the same
> words — no 'Sarah', no 'Nimbus', no 'React'."

Switch to the Recall tab. Ask: *"Who did I meet that's hiring frontend people?"*

> "It found Sarah Chen — and it shows me the exact memory that answer came from.
> That's the vector index doing real semantic matching, and the citation means
> the answer is never invented. Click the name…"

Click through to Sarah's profile.

> "…and here's everything Recall knows about her, with a timeline of every memory."

### 1:30–1:50 — Follow through
> "The Today feed is the proactive agent. These are follow-ups that are due —
> with a pre-drafted message I can copy in one tap. The daily nudge cron runs
> on AWS Lambda, so Recall acts without being asked."

Show: a Today card, copy the draft.

### 1:50–2:20 — The second agent (MCP)
> "Recall doesn't just *have* memory — you can *inspect* it. This is Claude Code
> connected to the same CockroachDB cluster through CockroachDB's **Managed MCP
> Server** — read-only, fully audited, no custom proxy."

In Claude Code, run a query:

```
> "Which person has the most memories?"
```

> "It answered by querying the live cluster. The MCP server is read-only by
> default, so this agent can observe the memory layer but never modify it. Two
> agents, one memory layer."

### 2:20–2:40 — Architecture + close
Show the architecture diagram (in the README / a slide).

> "One CockroachDB cluster: relational memory plus a distributed vector index,
> written in one transaction. Semantic recall with citations. A second agent
> inspecting it via MCP. Extraction and embeddings on AWS Bedrock. Deployed on
> App Runner with the nudge cron on Lambda. That's Recall."

## After recording

- Upload to YouTube (unlisted is fine; "public" includes unlisted) or Vimeo.
- Paste the URL into the Devpost submission.
- Keep the raw recording until winners are announced.
