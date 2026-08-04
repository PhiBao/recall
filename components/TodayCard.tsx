"use client";

import { useState, useTransition } from "react";
import { commitmentAction } from "@/app/actions";
import type { TodayItem } from "@/lib/types";

/**
 * A single follow-up card in the "Today" feed.
 * Actions: Done (complete), Snooze (+3 days), or copy the drafted message.
 */
export function TodayCard({ item }: { item: TodayItem }) {
  const [gone, setGone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { commitment, personName, reason, draftMessage } = item;

  function act(status: "done" | "snoozed" | "dismissed") {
    startTransition(async () => {
      const res = await commitmentAction(commitment.id, status);
      if (res.ok) setGone(true);
    });
  }

  async function copyDraft() {
    if (!draftMessage) return;
    try {
      await navigator.clipboard.writeText(draftMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  if (gone) return null;

  return (
    <div className="animate-fade-up rounded-xl border border-ink/10 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          {personName && (
            <p className="text-sm font-semibold">{personName}</p>
          )}
          <p className="text-sm text-ink/70">{commitment.description}</p>
        </div>
        <span
          className={[
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
            reason === "overdue"
              ? "bg-accent/15 text-accent"
              : "bg-ink/10 text-ink/60",
          ].join(" ")}
        >
          {reason}
        </span>
      </div>

      {draftMessage && (
        <button
          onClick={copyDraft}
          className="mt-3 w-full rounded-lg border border-ink/10 bg-paper px-3 py-2 text-left text-xs text-ink/60 transition hover:border-accent/40"
        >
          {copied ? "Copied ✓" : `“${draftMessage.slice(0, 80)}…” — copy draft`}
        </button>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => act("done")}
          disabled={isPending}
          className="flex-1 rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-paper transition hover:bg-ink/90 disabled:opacity-40"
        >
          Done
        </button>
        <button
          onClick={() => act("snoozed")}
          disabled={isPending}
          className="rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink/70 transition hover:bg-paper disabled:opacity-40"
        >
          Snooze
        </button>
        <button
          onClick={() => act("dismissed")}
          disabled={isPending}
          className="rounded-lg px-3 py-1.5 text-xs text-ink/40 transition hover:text-ink disabled:opacity-40"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
