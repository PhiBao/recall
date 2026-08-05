# CockroachDB AI tools feedback

Optional hackathon deliverable — genuine feedback on the tools used. Sponsors
read these.

## Distributed Vector Indexing

**What worked well:**
- The `VECTOR(n)` type + `CREATE VECTOR INDEX` feels native, not bolted on. Writing
  the embedding and the relational facts in the *same transaction* was the core
  thesis of this project, and CockroachDB is the only store that makes that
  possible without a separate vector DB. That story is easy to tell.
- The `pg` driver "just works" — no custom client, no wire-format surprises. The
  vector literal syntax (`[0.1,0.2,…]`) is simple.

**Friction:**
- **Model access opacity (embeddings):** The single biggest blocker in this
  project. The chat path (Bedrock Mantle) worked immediately, but Titan
  embeddings returned `Operation not allowed` — a silent, unhelpful error that
  took real effort to trace to "Bedrock Model access" + IAM `InvokeModel`. For a
  database product whose pitch is "the vector index is built in", the *embeddings*
  that fill that index still come from a separate Bedrock permission surface with
  no in-product guidance. A hint like "embeddings need Titan model access — enable
  it here" in the error path (or in the vector-index docs) would have saved the
  most time in this entire build.
- The `CREATE VECTOR INDEX` docs are clear on syntax but light on *operational*
  behavior: how does recall@k degrade as the index builds? When is the index
  "ready"? A progress indicator or a note on build semantics would help.

## Managed MCP Server

**What worked well:**
- The pitch is exactly right: read-only by default, audited, zero proxy. That's
  the safest way to hand a database to an AI agent, and it matches how we'd
  actually operate prod infrastructure.
- The "connect with a single config snippet" story is compelling for demos.

**Friction:**
- The exact MCP package name / config shape for Claude Code vs. Cursor vs. VS Code
  wasn't obvious from the hackathon landing page — I had to infer it. A pinned
  "copy this into your tool" snippet per client would lower the setup time to
  seconds. The example config in this repo (`mcp-config.example.json`) is a
  placeholder for exactly that.
- It wasn't clear whether the MCP server surfaces the vector index for semantic
  queries, or only relational tables. If an agent *could* run a KNN query over
  `memory_embedding` through MCP, that would be a standout demo.

## Overall

CockroachDB's AI tooling is genuinely differentiated — the combination of
transactional vector writes, distributed vector indexing, and an audited MCP
surface is something no other database offers as a coherent story. The main
improvement is on the *embedding supply side*: the vector index is the destination,
but getting embeddings into it still requires jumping through Bedrock permissions
that feel disconnected from the database product. Tightening that loop would
make the "memory is a database problem" story land even harder.
