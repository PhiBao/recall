import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";
import { query, queryOne } from "./db";
import type { AppUser } from "./types";

/**
 * Lightweight session auth.
 *
 * MVP scope: passwordless "sign in with email" — we create/find the user by
 * email and issue a signed, httpOnly session cookie (JWT). This keeps the demo
 * frictionless while enforcing strict per-user data isolation: every data query
 * is scoped by the authenticated user_id.
 *
 * NOTE: For production we would add an email magic-link verification step
 * (send a one-time link) before issuing the session. That is intentionally out
 * of scope for the hackathon MVP and documented as a non-goal.
 */

const COOKIE = "recall_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env().AUTH_SECRET);
}

export async function createSession(userId: string): Promise<string> {
  return await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SEC}s`)
    .sign(secretKey());
}

export async function setSessionCookie(userId: string): Promise<void> {
  const token = await createSession(userId);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** Returns the authenticated user id, or null. */
export async function getUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Returns the authenticated user row, or null. */
export async function getCurrentUser(): Promise<AppUser | null> {
  const userId = await getUserId();
  if (!userId) return null;
  return await queryOne<AppUser>(
    `SELECT id, email, name, created_at FROM app_user WHERE id = $1`,
    [userId],
  );
}

/** Throws if not authenticated; used by server actions / API routes. */
export async function requireUserId(): Promise<string> {
  const userId = await getUserId();
  if (!userId) throw new Error("UNAUTHENTICATED");
  return userId;
}

/** Find or create a user by email, returning the id. Email is normalized. */
export async function findOrCreateUser(
  email: string,
  name?: string,
): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM app_user WHERE email = $1`,
    [normalized],
  );
  if (existing) return existing.id;

  const rows = await query<{ id: string }>(
    `INSERT INTO app_user (email, name) VALUES ($1, $2) RETURNING id`,
    [normalized, name?.trim() || null],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("Failed to create user");
  return id;
}
