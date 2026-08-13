import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { authenticateApiKey } from "@/lib/api-keys";

/**
 * Recall's own MCP server — a read-only Model Context Protocol endpoint.
 *
 * A signed-in Recall user generates an API key (in the app), then any MCP
 * client (Claude Code, Cursor, ...) connects here with `Authorization: Bearer
 * <key>` and queries THEIR memory. Every statement is scoped by the key's
 * user_id, so a key can never read another user's data.
 *
 * Add to Claude Code:
 *   claude mcp add recall http://localhost:3000/api/mcp --transport http \
 *     --header "Authorization: Bearer <your-key>"
 * (in production: https://main.<app>.amplifyapp.com/api/mcp)
 *
 * Implements the streamable-HTTP subset: initialize, tools/list, tools/call.
 */
export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2025-03-26";

interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const READ_TOOLS: Tool[] = [
  {
    name: "list_tables",
    description:
      "List the tables in Recall's database (your memory schema).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_table_schema",
    description: "Get the schema (columns) of a table in Recall's database.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name, e.g. memory" },
      },
      required: ["table"],
    },
  },
  {
    name: "select_query",
    description:
      "Run a read-only SELECT against Recall's database. Only SELECT (no INSERT/UPDATE/DELETE). Every query is auto-scoped to the authenticated user's data.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "SELECT statement" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_people",
    description: "List all people the user has captured memories about.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "search_memories",
    description:
      "Search the user's memories by text/name. Returns the matching raw memory rows (the source of truth the product recalls from).",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Search terms" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
      required: ["q"],
    },
  },
];

const ALLOWED_TABLES = new Set([
  "app_user",
  "person",
  "memory",
  "memory_embedding",
  "fact",
  "commitment",
  "audit_log",
  "api_key",
]);

function mcpError(id: unknown, message: string): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32603, message },
  };
}

function mcpResult(id: unknown, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

async function handleCall(
  userId: string,
  id: unknown,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    switch (name) {
      case "list_tables": {
        const rows = await query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' ORDER BY table_name`,
        );
        return mcpResult(id, {
          content: [{ type: "text", text: rows.map((r) => r.table_name).join("\n") }],
        });
      }
      case "get_table_schema": {
        const table = String(args.table ?? "");
        if (!ALLOWED_TABLES.has(table)) {
          return mcpError(id, `Unknown table: ${table}`);
        }
        const cols = await query<{ column_name: string; data_type: string }>(
          `SELECT column_name, data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
          [table],
        );
        return mcpResult(id, {
          content: [
            {
              type: "text",
              text: cols.map((c) => `${c.column_name} ${c.data_type}`).join("\n"),
            },
          ],
        });
      }
      case "select_query": {
        const sql = String(args.query ?? "").trim().replace(/;\s*$/, "");
        if (!/^\s*select\b/i.test(sql)) {
          return mcpError(id, "Only SELECT statements are allowed (read-only).");
        }
        if (/\b(insert|update|delete|drop|alter|create|truncate|grant|copy)\b/i.test(sql)) {
          return mcpError(id, "Only SELECT statements are allowed (read-only).");
        }
        // Force per-user scoping: inject `user_id = $1` into the WHERE clause
        // (or add one) so a key can never read another user's rows.
        const whereIdx = /\bwhere\b/i.exec(sql)?.index;
        const scoped = whereIdx
          ? `${sql.slice(0, whereIdx)} WHERE user_id = $1 AND ${sql.slice(whereIdx + 5)}`
          : `${sql} WHERE user_id = $1`;
        const rows = await query<Record<string, unknown>>(`${scoped} LIMIT 25`, [userId]);
        const preview = rows.slice(0, 25).map((r) =>
          JSON.stringify(
            Object.fromEntries(
              Object.entries(r).filter(([, v]) => v !== undefined),
            ),
          ),
        );
        return mcpResult(id, {
          content: [{ type: "text", text: preview.join("\n") }],
          meta: { rowCount: rows.length },
        });
      }
      case "list_people": {
        const rows = await query<{ name: string; headline: string | null }>(
          `SELECT name, headline FROM person WHERE user_id = $1 ORDER BY name`,
          [userId],
        );
        return mcpResult(id, {
          content: [
            {
              type: "text",
              text:
                rows.map((r) => `${r.name}${r.headline ? ` — ${r.headline}` : ""}`).join("\n") ||
                "(no people yet)",
            },
          ],
        });
      }
      case "search_memories": {
        const q = String(args.q ?? "").trim();
        const limit = Math.min(Math.max(Number(args.limit ?? 10) || 10, 1), 25);
        if (!q) return mcpError(id, "q is required");
        const rows = await query<{ person_name: string | null; content: string; occurred_at: string }>(
          `SELECT p.name AS person_name, m.content, m.occurred_at
             FROM memory m
             LEFT JOIN person p ON p.id = m.person_id
            WHERE m.user_id = $1
              AND (lower(m.content) LIKE '%' || lower($2) || '%'
                   OR lower(coalesce(p.name,'')) LIKE '%' || lower($2) || '%')
            ORDER BY m.occurred_at DESC
            LIMIT $3`,
          [userId, q, limit],
        );
        return mcpResult(id, {
          content: [
            {
              type: "text",
              text:
                rows
                  .map((r) => `${r.person_name ?? "note"} (${r.occurred_at}): ${r.content}`)
                  .join("\n") || "(no matching memories)",
            },
          ],
        });
      }
      default:
        return mcpError(id, `Unknown tool: ${name}`);
    }
  } catch (err) {
    return mcpError(id, err instanceof Error ? err.message : String(err));
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Auth: Bearer API key.
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const key = token ? await authenticateApiKey(token) : null;
  if (!key) {
    return NextResponse.json(
      { error: "invalid_token", error_description: "Authorization required" },
      { status: 401 },
    );
  }
  const { userId } = key;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const method = typeof body.method === "string" ? body.method : "";
  const id = body.id ?? null;

  if (method === "initialize") {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "recall-mcp", version: "1.0.0" },
        },
      },
      { headers: { "mcp-session-id": crypto.randomUUID() } },
    );
  }
  if (method === "notifications/initialized") {
    return new NextResponse(null, { status: 202 });
  }
  if (method === "tools/list") {
    return NextResponse.json(
      mcpResult(id, { tools: READ_TOOLS }),
      { headers: { "mcp-session-id": req.headers.get("mcp-session-id") ?? "" } },
    );
  }
  if (method === "tools/call") {
    const params = (body.params ?? {}) as Record<string, unknown>;
    const toolName = typeof params.name === "string" ? params.name : "";
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const res = await handleCall(userId, id, toolName, args);
    return NextResponse.json(res, {
      headers: { "mcp-session-id": req.headers.get("mcp-session-id") ?? "" },
    });
  }

  return NextResponse.json(mcpError(id, `Unsupported method: ${method}`), { status: 400 });
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { error: "invalid_request", error_description: "This is an MCP endpoint. POST JSON-RPC here." },
    { status: 400 },
  );
}
