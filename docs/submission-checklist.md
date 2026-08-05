# Hackathon submission checklist

Copy this into the Devpost submission. Everything here is implemented in the
repo; items marked **[action]** need a one-time action before submitting.

## Required

- [x] **Public open-source repo** with a detectable license
  - This repo, MIT license (`LICENSE`), visible in the GitHub About section.
- [x] **Functional demo URL**
  - Deploy on AWS App Runner (`docs/deploy-aws.md`). The URL goes in Devpost.
  - **[action]** Deploy it and paste the URL here: `________________`
- [ ] **Video (< 3 min)** on YouTube or Vimeo, demonstrating the submission and
      the CockroachDB memory layer at work.
  - **[action]** Follow `docs/video-script.md`, record, upload, paste URL here:
        `________________`
- [x] **≥ 2 CockroachDB tools used — identified + explained how**
  1. **Distributed Vector Indexing** — `memory_embedding` uses `VECTOR(1024)` +
     `CREATE VECTOR INDEX`. Capture writes the embedding + relational facts in one
     transaction (no drift); recall runs semantic KNN joined to people in one
     query. Every answer cites its source memory.
  2. **Managed MCP Server** — a second agent (Claude Code/Cursor) connects to the
     cluster read-only via `https://cockroachlabs.cloud/mcp` to inspect the
     memory layer: audit log, data health, network insights. It can never modify
     data. (`docs/ops-agent.md`)
- [x] **≥ 1 AWS service used — identified + explained how**
  1. **Amazon Bedrock — Mantle endpoint**: chat (extraction + recall synthesis)
     via Voxtral Mini, Bedrock API key auth.
  2. **Amazon Bedrock — Titan Text Embeddings v2**: 1024-dim vectors for the
     vector index, IAM auth.
  3. **AWS App Runner**: hosts the demo from a container.
  4. **AWS Lambda + EventBridge**: daily nudge cron, serverless.
- [x] **Clear README** with setup/run instructions (`README.md`).

## Optional (strengthens the entry)

- [x] **Architecture diagram** — in `README.md`, shows two agents over one
      memory layer + Bedrock + AWS.
- [x] **Feedback on CockroachDB AI tools** — `docs/feedback-cockroachdb.md`.
- [ ] **Real Titan embeddings verified** — `pnpm embed:verify` must PASS and
      `pnpm db:seed-embeddings` re-seeded before the demo. See
      `docs/embedding-fix.md`.
      **[action]** Enable Titan model access in the Bedrock console, verify,
      re-seed.

## Judges' criteria — how Recall maps

| Criterion | Where it's addressed |
|---|---|
| **Agentic Memory Design** | Relational + vector memory in one transactional cluster; capture/recall are single-transaction, single-query; citations; hybrid KNN + join. MCP ops agent observes the same layer. |
| **Technical Implementation** | Distributed Vector Indexing done right (transactional writes, vector index); MCP Server used safely (read-only, audited); strict per-user isolation; parameterized SQL; mock-AI fallback. |
| **Real-World Impact** | Relationship memory for founders/sales/recruiters/investors — a frequent, emotionally charged pain that CRMs are too heavy for and note apps don't solve. |
| **Production Readiness** | Rate limiting, structured logging, health endpoint, audit log, signed httpOnly sessions, Zod validation, fail-fast config, tests, deployed on AWS. |
| **Creativity & Originality** | "Memory is a database problem" — no Postgres+Pinecone drift; two agents over one memory layer; proactive nudge agent via Lambda. |
