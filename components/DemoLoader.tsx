"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { seedDemoAction } from "@/app/actions";

/**
 * One-click demo: capture eight real stories through the real pipeline
 * (Bedrock extraction → Jev judgments → encrypted Walrus blobs).
 *
 * Why it exists: a judge should not have to hand-type eight memories to see
 * whether the product works, and the resulting blobs are genuine mainnet
 * objects — this is the same code path a real user hits.
 */
export function DemoLoader() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    setProgress("Capturing… each memory becomes an encrypted blob on Walrus.");
    startTransition(async () => {
      const res = await seedDemoAction();
      if (res.ok) {
        setProgress(
          `Done — ${res.captured} memories, ${res.people} people, ${res.blobs} Walrus blobs.`,
        );
        router.refresh();
      } else {
        setError(res.error);
        setProgress(null);
      }
    });
  }

  return (
    <div className="rounded-2xl border border-dashed border-ink/20 bg-white/60 p-4">
      <p className="text-sm font-medium">Nothing here yet</p>
      <p className="mt-1 text-xs text-ink/60">
        Load eight realistic networking memories through the real capture
        pipeline, or paste your own below. Both write encrypted blobs to
        Walrus.
      </p>
      <button
        onClick={run}
        disabled={isPending}
        className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent/90 disabled:cursor-wait disabled:opacity-50"
      >
        {isPending ? "Loading demo…" : "Load the demo story"}
      </button>
      {progress && <p className="mt-2 text-xs text-ink/50">{progress}</p>}
      {error && <p className="mt-2 text-xs text-accent">{error}</p>}
    </div>
  );
}
