/**
 * Verify a CockroachDB Cloud MCP connection with your own API key.
 *
 * Each user connects the Managed MCP Server to the clusters THEY can access,
 * using a key THEY generate. This script does the MCP handshake against the
 * live endpoint (https://cockroachlabs.cloud/mcp) with a Bearer token and
 * lists the tools available — proof the connection works before you wire it
 * into Claude Code / Cursor.
 *
 * Usage:
 *   export COCKROACH_MCP_API_KEY="<your-service-account-secret>"
 *   pnpm exec tsx scripts/mcp-verify.ts
 *
 * You can also run a read-only query on one of your clusters:
 *   COCKROACH_MCP_QUERY="select count(*) from recall.memory" pnpm exec tsx scripts/mcp-verify.ts
 */
import { loadEnv } from "./load-env";
loadEnv();

const ENDPOINT = "https://cockroachlabs.cloud/mcp";

async function mcpFetch(
  sessionId: string | null,
  body: Record<string, unknown>,
  token: string,
): Promise<{ sessionId: string | null; result: unknown }> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const nextSession = res.headers.get("mcp-session-id");
  const raw = await res.text();
  // Responses can be SSE (event-stream) or JSON. Handle both.
  let payload: unknown;
  if (raw.trimStart().startsWith("event:")) {
    const dataLine = raw
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("");
    payload = JSON.parse(dataLine || "{}");
  } else {
    payload = JSON.parse(raw);
  }
  return { sessionId: nextSession, result: payload };
}

async function main() {
  const token = process.env.COCKROACH_MCP_API_KEY;
  if (!token) {
    console.error(
      "[mcp] COCKROACH_MCP_API_KEY is required.\n" +
        "Create one: CockroachDB Cloud Console → Access management → Service accounts → Create service account → copy the secret.",
    );
    process.exit(1);
  }

  console.log("[mcp] connecting to", ENDPOINT, "(Bearer key present)");

  // 1. initialize
  let { sessionId, result } = await mcpFetch(
    null,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "recall-mcp-verify", version: "0.1.0" },
      },
    },
    token,
  );
  console.log("[mcp] initialize OK", JSON.stringify(result).slice(0, 160));

  // 2. notifications/initialized (fire and forget)
  await mcpFetch(sessionId, { jsonrpc: "2.0", method: "notifications/initialized" }, token);

  // 3. tools/list
  ({ sessionId, result } = await mcpFetch(
    sessionId,
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    token,
  ));
  const tools = (result as { result?: { tools?: { name: string }[] } })?.result?.tools ?? [];
  console.log("[mcp] tools available:");
  for (const t of tools) console.log("   -", t.name);

  // 4. optional read-only query on one cluster
  const query = process.env.COCKROACH_MCP_QUERY;
  if (query) {
    console.log(`[mcp] running read-only query: ${query}`);
    ({ sessionId, result } = await mcpFetch(
      sessionId,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "select_query", arguments: { query } },
      },
      token,
    ));
    console.log("[mcp] query result:", JSON.stringify(result).slice(0, 500));
  }

  console.log("[mcp] connection verified ✔  Now add it to your AI tool (see docs/ops-agent.md).");
}

main().catch((err) => {
  console.error("[mcp] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
