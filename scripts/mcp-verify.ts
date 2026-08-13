/**
 * Verify an MCP connection with your own key.
 *
 * Two modes:
 *
 * 1. Recall's own MCP server (per-user): a signed-in user's API key from the
 *    app (recu_...). Reads your OWN memory, scoped to you.
 *      export RECALL_MCP_API_KEY="<your-recall-key>"
 *      pnpm exec tsx scripts/mcp-verify.ts
 *
 * 2. CockroachDB Cloud Managed MCP server: a service-account secret. Reads the
 *    clusters your account can access.
 *      export COCKROACH_MCP_API_KEY="<your-service-account-secret>"
 *      pnpm exec tsx scripts/mcp-verify.ts
 *
 * You can also run a read-only query after verifying:
 *   RECALL_MCP_QUERY="select count(*) from memory" pnpm exec tsx scripts/mcp-verify.ts
 */
import { loadEnv } from "./load-env";
loadEnv();

// Prefer Recall's own MCP server when a Recall key is provided.
const recallKey = process.env.RECALL_MCP_API_KEY;
const cockKey = process.env.COCKROACH_MCP_API_KEY;
const token = recallKey ?? cockKey ?? "";
const ENDPOINT = recallKey
  ? `${process.env.APP_URL ?? "http://localhost:3000"}/api/mcp`
  : "https://cockroachlabs.cloud/mcp";

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
  const raw = (await res.text()).trim();
  // Notifications (e.g. notifications/initialized) return an empty 202.
  if (!raw) return { sessionId: nextSession, result: null };
  // Responses can be SSE (event-stream) or JSON. Handle both.
  let payload: unknown;
  if (raw.startsWith("event:")) {
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
  const token = recallKey ?? cockKey;
  if (!token) {
    console.error(
      "[mcp] Provide a key to verify.\n" +
        "  Recall's own MCP:    export RECALL_MCP_API_KEY=\"<your-recall-key>\"\n" +
        "  CockroachDB Cloud:   export COCKROACH_MCP_API_KEY=\"<your-service-account-secret>\"",
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

  // 4. optional read-only query
  const query = process.env.RECALL_MCP_QUERY ?? process.env.COCKROACH_MCP_QUERY;
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
