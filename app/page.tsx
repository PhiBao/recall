import { redirect } from "next/navigation";
import { getUserId } from "@/lib/auth";
import { signInAction } from "./actions";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Already signed in? Go straight to the app.
  if (await getUserId()) redirect("/app");
  const { error } = await searchParams;

  return (
    <main className="min-h-screen bg-ink text-paper">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6">
        <header className="flex items-center gap-2 pt-8">
          <span className="text-xl">🪳</span>
          <span className="font-semibold tracking-tight">Recall</span>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            Never forget a person again.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-paper/70">
            Tell Recall about the people you meet, in plain words. It remembers
            every detail, recalls it instantly, and nudges you to follow up at
            the right moment.
          </p>

          <form
            action={signInAction}
            className="mt-10 flex w-full max-w-md flex-col gap-3"
          >
            <input
              type="text"
              name="name"
              placeholder="Your name (optional)"
              className="w-full rounded-xl border border-paper/15 bg-ink-soft px-4 py-3 text-paper placeholder:text-paper/40 focus:border-accent focus:outline-none"
              autoComplete="name"
            />
            <input
              type="email"
              name="email"
              required
              placeholder="you@example.com"
              className="w-full rounded-xl border border-paper/15 bg-ink-soft px-4 py-3 text-paper placeholder:text-paper/40 focus:border-accent focus:outline-none"
              autoComplete="email"
            />
            <button
              type="submit"
              className="w-full rounded-xl bg-accent px-4 py-3 font-semibold text-white transition hover:bg-accent/90"
            >
              Start remembering
            </button>
            {error === "invalid_email" && (
              <p className="text-sm text-accent-soft">
                Please enter a valid email address.
              </p>
            )}
            <p className="mt-1 text-xs text-paper/40">
              No password. We create your private memory space instantly.
            </p>
          </form>
        </div>

        <section className="grid gap-6 pb-20 sm:grid-cols-3">
          <Feature
            title="Capture in seconds"
            body="Just say what happened. Recall extracts who you met, the details, and what you promised."
          />
          <Feature
            title="Recall anything"
            body="Ask “who was hiring React devs?” and get an answer with the exact memory it came from."
          />
          <Feature
            title="Follow through"
            body="A daily list of who to reconnect with, so relationships never go cold."
          />
        </section>

        <footer className="border-t border-paper/10 py-6 text-center text-xs text-paper/40">
          Built on CockroachDB (distributed vector memory) + AWS Bedrock.
        </footer>
      </div>
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-paper/10 bg-ink-soft p-6 text-left">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-paper/60">{body}</p>
    </div>
  );
}
