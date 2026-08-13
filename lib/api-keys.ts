import { createHash, randomBytes } from "node:crypto";
import { query, queryOne, withTransaction } from "./db";
import { log } from "./log";

/**
 * Per-user API keys for Recall's MCP server.
 *
 * A signed-in user generates a key (`recu_<random>`); we store only its
 * SHA-256 hash and a short display prefix. The raw key is shown exactly once,
 * at creation. Authentication (via Bearer token) looks up the hash — so even a
 * DB leak exposes no usable keys.
 */

export interface ApiKey {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

const PREFIX = "recu_";

function sha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Generate a fresh key for a user. Returns the raw key (show ONCE). */
export async function createApiKey(
  userId: string,
  name = "default",
): Promise<{ id: string; rawKey: string; prefix: string }> {
  const rawKey = `${PREFIX}${randomBytes(24).toString("base64url")}`;
  const prefix = `${PREFIX}${rawKey.slice(PREFIX.length, PREFIX.length + 6)}`;
  const rows = await query<{ id: string }>(
    `INSERT INTO api_key (user_id, name, prefix, key_hash)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, name.slice(0, 60), prefix, sha256(rawKey)],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("Failed to create API key");
  await logAudit(userId, "api_key_created", { keyId: id, name });
  return { id, rawKey, prefix };
}

/** List a user's non-revoked keys (no hashes). */
export async function listApiKeys(userId: string): Promise<ApiKey[]> {
  return await query<ApiKey>(
    `SELECT id, user_id, name, prefix, last_used_at, created_at, revoked_at
       FROM api_key
      WHERE user_id = $1 AND revoked_at IS NULL
      ORDER BY created_at DESC`,
    [userId],
  );
}

export async function revokeApiKey(userId: string, keyId: string): Promise<void> {
  const res = await query(
    `UPDATE api_key SET revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [keyId, userId],
  );
  if (res.length > 0) await logAudit(userId, "api_key_revoked", { keyId });
}

/**
 * Resolve a raw bearer token to a user id + key id, or null if invalid.
 * Touches last_used_at on success.
 */
export async function authenticateApiKey(
  rawKey: string,
): Promise<{ userId: string; keyId: string } | null> {
  if (!rawKey.startsWith(PREFIX)) return null;
  const hash = sha256(rawKey);
  const row = await queryOne<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM api_key
      WHERE key_hash = $1 AND revoked_at IS NULL`,
    [hash],
  );
  if (!row) return null;
  // Best-effort usage tracking; never fails auth.
  await query(
    `UPDATE api_key SET last_used_at = now() WHERE id = $1`,
    [row.id],
  ).catch(() => {});
  return { userId: row.user_id, keyId: row.id };
}

function logAudit(userId: string, action: string, detail: Record<string, unknown>): void {
  query(
    `INSERT INTO audit_log (user_id, action, detail) VALUES ($1, $2, $3)`,
    [userId, action, JSON.stringify(detail)],
  ).catch((err) => log.warn("audit_log_failed", { error: String(err) }));
}

export { withTransaction };
