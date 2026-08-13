"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  findOrCreateUser,
  setSessionCookie,
  clearSessionCookie,
  requireUserId,
} from "@/lib/auth";
import {
  captureMemory,
  recall,
  updateCommitmentStatus,
} from "@/lib/memory";
import { userActionLimiter } from "@/lib/rate-limit";
import { log } from "@/lib/log";
import { createApiKey, revokeApiKey } from "@/lib/api-keys";
import type { RecallAnswer } from "@/lib/types";

/**
 * Server actions — the only write path from the UI. Every action that touches
 * data first resolves the authenticated user id and scopes all work to it.
 */

const emailSchema = z.string().email().max(254);
const nameSchema = z.string().min(1).max(120).optional();

export async function signInAction(formData: FormData): Promise<void> {
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) {
    redirect("/?error=invalid_email");
  }
  const name = nameSchema.safeParse(formData.get("name") || undefined);
    const userId = await findOrCreateUser(
      email.data,
      name.success ? name.data : undefined,
    );
    await setSessionCookie(userId);
    log.info("sign_in", { userId });
    redirect("/app");
}

export async function signOutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/");
}

const captureSchema = z.string().min(1).max(4000);

export async function captureAction(
  rawText: string,
): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  const userId = await requireUserId();
  try {
    if (!userActionLimiter.check(userId)) {
      return { ok: false, error: "You're saving memories quickly — please slow down a moment." };
    }
    const parsed = captureSchema.safeParse(rawText);
    if (!parsed.success) return { ok: false, error: "Please write a little more." };
    const result = await captureMemory(userId, parsed.data);
    revalidatePath("/app");
    log.info("capture", { userId, memoryId: result.memory.id, facts: result.factsAdded, commitments: result.commitmentsAdded });
    return { ok: true, summary: result.summary };
  } catch (err) {
    log.error("capture_failed", { userId, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: "Something went wrong saving that memory." };
  }
}

const recallSchema = z.string().min(1).max(4000);

export async function recallAction(
  question: string,
): Promise<{ ok: true; result: RecallAnswer } | { ok: false; error: string }> {
  const userId = await requireUserId();
  try {
    if (!userActionLimiter.check(userId)) {
      return { ok: false, error: "You're asking a lot of questions — give it a beat." };
    }
    const parsed = recallSchema.safeParse(question);
    if (!parsed.success) return { ok: false, error: "Please ask a question." };
    const result = await recall(userId, parsed.data);
    log.info("recall", { userId, citations: result.citations.length });
    return { ok: true, result };
  } catch (err) {
    log.error("recall_failed", { userId, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: "Something went wrong searching your memory." };
  }
}

const statusSchema = z.enum(["done", "snoozed", "dismissed"]);

export async function commitmentAction(
  commitmentId: string,
  status: string,
): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  try {
    const s = statusSchema.parse(status);
    const id = z.string().uuid().parse(commitmentId);
    await updateCommitmentStatus(userId, id, s);
    revalidatePath("/app");
    log.info("commitment_status", { userId, commitmentId: id, status: s });
    return { ok: true };
  } catch (err) {
    log.error("commitment_status_failed", { userId, commitmentId, status, error: err instanceof Error ? err.message : String(err) });
    return { ok: false };
  }
}

const apiKeyNameSchema = z.string().min(1).max(60).optional();

/** Generate a new API key. The raw key is returned once — show it to the user. */
export async function generateApiKeyAction(
  name?: string,
): Promise<{ ok: true; rawKey: string; prefix: string } | { ok: false; error: string }> {
  const userId = await requireUserId();
  try {
    if (!userActionLimiter.check(userId)) {
      return { ok: false, error: "Slow down — you're doing too much right now." };
    }
    const parsed = apiKeyNameSchema.safeParse(name);
    const label = parsed.success && parsed.data ? parsed.data : "default";
    const key = await createApiKey(userId, label);
    revalidatePath("/app");
    return { ok: true, rawKey: key.rawKey, prefix: key.prefix };
  } catch (err) {
    log.error("api_key_generate_failed", { userId, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: "Could not create an API key." };
  }
}

/** Revoke an API key. */
export async function revokeApiKeyAction(
  keyId: string,
): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  try {
    const id = z.string().uuid().parse(keyId);
    await revokeApiKey(userId, id);
    revalidatePath("/app");
    return { ok: true };
  } catch (err) {
    log.error("api_key_revoke_failed", { userId, keyId, error: err instanceof Error ? err.message : String(err) });
    return { ok: false };
  }
}
