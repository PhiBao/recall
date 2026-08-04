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
  try {
    const userId = await requireUserId();
    const parsed = captureSchema.safeParse(rawText);
    if (!parsed.success) return { ok: false, error: "Please write a little more." };
    const result = await captureMemory(userId, parsed.data);
    revalidatePath("/app");
    return { ok: true, summary: result.summary };
  } catch (err) {
    console.error("[captureAction]", err);
    return { ok: false, error: "Something went wrong saving that memory." };
  }
}

const recallSchema = z.string().min(1).max(4000);

export async function recallAction(
  question: string,
): Promise<{ ok: true; result: RecallAnswer } | { ok: false; error: string }> {
  try {
    const userId = await requireUserId();
    const parsed = recallSchema.safeParse(question);
    if (!parsed.success) return { ok: false, error: "Please ask a question." };
    const result = await recall(userId, parsed.data);
    return { ok: true, result };
  } catch (err) {
    console.error("[recallAction]", err);
    return { ok: false, error: "Something went wrong searching your memory." };
  }
}

const statusSchema = z.enum(["done", "snoozed", "dismissed"]);

export async function commitmentAction(
  commitmentId: string,
  status: string,
): Promise<{ ok: boolean }> {
  try {
    const userId = await requireUserId();
    const s = statusSchema.parse(status);
    const id = z.string().uuid().parse(commitmentId);
    await updateCommitmentStatus(userId, id, s);
    revalidatePath("/app");
    return { ok: true };
  } catch (err) {
    console.error("[commitmentAction]", err);
    return { ok: false };
  }
}
