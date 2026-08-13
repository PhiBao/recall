# Ops Agent — introspecting Recall's memory layer via MCP

Recall ships **two MCP surfaces**:

1. **CockroachDB Cloud Managed MCP Server** (`https://cockroachlabs.cloud/mcp`)
   — a hosted service that lets any AI agent inspect the *cluster* directly
   (see "Connect the Cloud MCP server" below). This is a required hackathon
   tool.
2. **Recall's own MCP server** (`/api/mcp`) — **every signed-in user can
   generate an API key** in the app and connect their agent to *their own
   memory*. See the next section.

## Recall's own MCP server — per-user API keys

Each Recall user (signs in with email) can generate an API key in the
**API keys · MCP access** panel of the app. That key lets their own agent read
*their* memory through Recall's MCP server — scoped strictly to that user.

1. Sign in → workspace → **API keys · MCP access** → **Generate API key**.
2. Copy the key (shown once).
3. Connect your agent, e.g. **Claude Code**:

```bash
claude mcp add recall https://main.d1920llq7pdf9e.amplifyapp.com/api/mcp \
  --transport http --header "Authorization: Bearer <your-key>"
```

4. Ask it about your network: *"which person is hiring React engineers?"*,
   *"who has the most memories?"*, *"show me the audit log."*

The endpoint exposes read-only tools: `list_tables`, `get_table_schema`,
`select_query` (auto-scoped by user), `list_people`, `search_memories`.
Only `SELECT` is allowed; every query is forced to filter by the key's
`user_id`. Keys store only a SHA-256 hash — never the raw secret.

Quick self-check with a real key:

```bash
export COCKROACH_MCP_API_KEY="<your-key>"
pnpm exec tsx scripts/mcp-verify.ts
```

---

## Connect the CockroachDB Cloud MCP server

The **CockroachDB Cloud Managed MCP Server** lets an AI agent query the cluster
directly. It's a hosted service at `https://cockroachlabs.cloud/mcp` — always
available, nothing to deploy. You just connect your tool and authenticate.

## Connect (option A) — OAuth with your Cloud login (recommended)

Recommended: short-lived tokens, no long-lived secret.

**Claude Code** (one command):

```bash
claude mcp add cockroachdb-cloud https://cockroachlabs.cloud/mcp --transport http
```

**Cursor**: CockroachDB Cloud Console → **Integrations** → **Connect MCP** →
**Cursor** → **Add to Cursor**. Or add manually to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "cockroachdb-cloud": { "url": "https://cockroachlabs.cloud/mcp" }
  }
}
```

**GitHub Copilot / VS Code**: Console → **Integrations** → **Connect MCP** →
**GitHub Copilot** → **Add to GitHub Copilot**. Or `.vscode/mcp.json`:

```json
{
  "servers": {
    "cockroachdb-cloud": { "type": "http", "url": "https://cockroachlabs.cloud/mcp" }
  }
}
```

Then **authenticate**: run `claude /mcp` (Claude Code) or open the MCP settings
in your tool, select `cockroachdb-cloud`, choose **Authenticate**, log in to
CockroachDB Cloud in the browser, pick your organization, and authorize
read/write.

## Connect (option B) — service-account API key

1. CockroachDB Cloud Console → **Access management** → **Service accounts** →
   **Create service account** → assign **Cluster Admin** or **Cluster Operator**
   on the cluster. Copy the generated secret (shown once).
2. Configure your tool with the key as a bearer token. **Claude Code**:

```bash
claude mcp add cockroachdb-cloud https://cockroachlabs.cloud/mcp --transport http \
  --header "Authorization: Bearer <your-service-account-api-key>"
```

## Try it yourself — each user generates their own key

The MCP server connects to the clusters **the authenticated user can access** —
not to one fixed account. So **every person can test it against their own
(possibly free) cluster**, with a key they generate themselves. No shared
secrets, no access to our cluster required:

1. **Create a free cluster** (if you don't have one):
   https://cockroachlabs.cloud → **Create cluster** (Serverless free tier).
2. **Create your own service account + API key**:
   Console → **Access management** → **Service accounts** → **Create service
   account** → assign a role on your cluster → copy the secret (shown once).
3. **Verify the connection in 5 seconds**:

   ```bash
   export COCKROACH_MCP_API_KEY="<your-secret>"
   pnpm exec tsx scripts/mcp-verify.ts
   ```

   → lists the MCP tools the endpoint exposes to your key. Or run a read-only
   query straight away:

   ```bash
   COCKROACH_MCP_QUERY="select count(*) from <your_db>.memory" \
     pnpm exec tsx scripts/mcp-verify.ts
   ```
4. **Wire it into your AI tool** (Claude Code / Cursor / VS Code) with the
   snippets above, using your own key.

> **Security note:** never commit or share a service-account secret. Each person
> uses their own; revoke yours in the Console anytime.

## (Optional) Scope to Recall's cluster

By default a connection can reach every cluster you can access. To limit it to
Recall's cluster, add the `mcp-cluster-id` header. Find the Cluster ID in the
cluster's **Overview** page URL:
`https://cockroachlabs.cloud/cluster/{cluster_id}/overview`.

```json
{
  "mcpServers": {
    "cockroachdb-cloud": {
      "type": "http",
      "url": "https://cockroachlabs.cloud/mcp",
      "headers": { "mcp-cluster-id": "<your-cluster-id>" }
    }
  }
}
```

(Our demo cluster host is `tribe-griffin-30783.j77.aws-ap-southeast-1.cockroachlabs.cloud`;
the numeric Cluster ID is on its Overview page.)

## What the ops agent can do

The MCP server exposes read tools (`list_clusters`, `list_tables`,
`get_table_schema`, `select_query`, `show_statement`, `explain_query`) and
write tools. In our demo we use it **read-only**. Connect Claude Code and ask:

- "List all tables in the recall database."
- "Show me the schema of `memory` and `memory_embedding`."
- "How many memories were captured in the last 7 days?"
- "Show the audit log — what's the most common action?"
- "Which person has the most memories?"
- "How many open follow-ups are overdue?"

Because the MCP server records activity in CockroachDB's own audit log and we
only grant read permissions, this is safe to demo against the live cluster: the
ops agent can observe the memory engine but never modify it.

## Why this matters for judging

- **Technical Implementation** (criterion #2): demonstrates the MCP Server
  integration correctly and safely — HTTP transport, OAuth/API-key auth, real
  queries against the live cluster.
- **Production Readiness** (criterion #4): an agent that observes the system is
  how you operate real infrastructure. The audit log becomes a first-class
  feature, not an afterthought.
- **Agentic Memory Design** (criterion #1): two distinct agents with different
  capabilities, both grounded in the same memory layer.

## Demo it in the video

A 30-second screen recording of Claude Code connected via MCP, running
`select_query` / `show_statement` against the live cluster ("which person has
the most memories?", "show the audit log") — that's the proof the MCP
integration is real and meaningful.
