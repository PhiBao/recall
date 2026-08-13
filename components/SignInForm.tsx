"use client";

import { useTransition } from "react";
import { signInAction } from "@/app/actions";

/**
 * Sign-in form with a real pending state.
 *
 * Creating a brand-new user does a DB round-trip (and on a cold serverless
 * instance it's slower than "instant"). Without feedback the user reloads
 * mid-request, before the session cookie is set — which lands them back on
 * this page. So we disable the button and show a spinner the whole time the
 * action is running; the redirect to /app only happens after the cookie is
 * written.
 */
export function SignInForm({ error }: { error?: string }) {
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isPending) return;
    const form = e.currentTarget;
    startTransition(async () => {
      await signInAction(new FormData(form));
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-10 flex w-full max-w-md flex-col gap-3"
    >
      <input
        type="text"
        name="name"
        placeholder="Your name (optional)"
        className="w-full rounded-xl border border-paper/15 bg-ink-soft px-4 py-3 text-paper placeholder:text-paper/40 focus:border-accent focus:outline-none"
        autoComplete="name"
        disabled={isPending}
      />
      <input
        type="email"
        name="email"
        required
        placeholder="you@example.com"
        className="w-full rounded-xl border border-paper/15 bg-ink-soft px-4 py-3 text-paper placeholder:text-paper/40 focus:border-accent focus:outline-none"
        autoComplete="email"
        disabled={isPending}
      />
      <button
        type="submit"
        disabled={isPending}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 font-semibold text-white transition hover:bg-accent/90 disabled:cursor-wait disabled:opacity-70"
      >
        {isPending && (
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
            aria-hidden
          />
        )}
        {isPending ? "Creating your memory space…" : "Start remembering"}
      </button>
      {error === "invalid_email" && (        <p className="text-sm text-accent-soft">
          Please enter a valid email address.
        </p>
      )}
      <p className="mt-1 text-xs text-paper/40">
        {isPending
          ? "First-time setup — this can take a few seconds."
          : "No password. We create your private memory space instantly."}
      </p>
    </form>
  );
}
