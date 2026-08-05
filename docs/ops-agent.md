# Ops Agent — introspecting Recall's memory layer via MCP

Recall's memory lives in one CockroachDB cluster. The **CockroachDB Cloud
Managed MCP Server** lets an AI agent (Claude Code, Cursor, VS Code) query that
cluster directly and safely — read-only by default, with full audit logging and
no custom proxy.

This is the **second CockroachDB tool** in the hackathon entry:

1. **Distributed Vector Indexing** — the memory engine (semantic KNN over
   `memory_embedding` + relational joins).
2. **Managed MCP Server** — a second, independent agent that *observes* the
   memory engine: inspecting the audit log, checking data health, surfacing
   insights about the user's network.

Having two agents — one that *writes and recalls* memory, another that *audits
and inspects* it — is the production-grade memory architecture the hackathon is
asking for. The MCP agent can never modify data; it only reads.

## Setup

1. In the **CockroachDB Cloud Console**, open your cluster → **MCP Server** →
   **Enable**. The console generates a config snippet for Claude Code / Cursor /
   /VS Code.
2. Paste that snippet into your AI tool's MCP config (see
   `mcp-config.example.json` for the shape — use the real values from the
   console).
3. The endpoint is `https://cockroachlabs.cloud/mcp`. Auth is handled by a
   short-lived token from the console; no IAM keys in the agent.

## What the ops agent can do

Connect Claude Code and ask it questions about the memory store. Example
prompts (these are the exact kinds of queries the agent runs):

- "Show me the audit log for the last 7 days — what's the most common action?"
- "Which person has the most memories captured?"
- "How many open follow-ups are overdue?"
- "List the tables and their row counts — is the schema healthy?"
- "Show me memories captured in the last 24 hours."

Because the MCP server is **read-only** and **audited**, this is safe to demo
with a live cluster: the ops agent can never insert, update, or delete a memory.
Every query it runs is recorded in CockroachDB's own audit log.

## Why this matters for judging

- **Technical Implementation** (criterion #2): demonstrates the MCP Server
  integration correctly and safely — read-only, audited, real queries.
- **Production Readiness** (criterion #4): an agent that observes the system is
  how you operate real infrastructure. The audit log becomes a first-class
  feature, not an afterthought.
- **Agentic Memory Design** (criterion #1): two distinct agents with different
  capabilities, both grounded in the same memory layer.

## Demo it in the video

A 30-second screen recording of Claude Code connected via MCP, answering
"which person has the most memories?" and "show me the audit log" against the
live cluster — that's the proof the MCP integration is real and meaningful.
