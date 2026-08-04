import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getUserId } from "@/lib/auth";
import {
  getPerson,
  getPersonFacts,
  getPersonMemories,
} from "@/lib/memory";

export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = await getUserId();
  if (!userId) redirect("/");
  const { id } = await params;

  const person = await getPerson(userId, id);
  if (!person) notFound();

  const [facts, memories] = await Promise.all([
    getPersonFacts(userId, id),
    getPersonMemories(userId, id),
  ]);

  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Link
          href="/app"
          className="text-sm text-ink/50 transition hover:text-ink"
        >
          ← Back
        </Link>

        <header className="mt-6 border-b border-ink/10 pb-6">
          <h1 className="text-3xl font-semibold tracking-tight">
            {person.name}
          </h1>
          {person.headline && (
            <p className="mt-1 text-ink/60">{person.headline}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink/50">
            {person.company && <span>🏢 {person.company}</span>}
            {person.location && <span>📍 {person.location}</span>}
            {person.last_interaction_at && (
              <span>
                🕑 Last:{" "}
                {new Date(person.last_interaction_at).toLocaleDateString()}
              </span>
            )}
          </div>
        </header>

        {/* Facts */}
        <section className="mt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink/40">
            What you know
          </h2>
          {facts.length === 0 ? (
            <p className="text-sm text-ink/50">
              No structured details yet — they’ll appear as you capture more.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {facts.map((f) => (
                <span
                  key={f.id}
                  className="rounded-lg border border-ink/10 bg-white px-3 py-1.5 text-sm"
                  title={`from a memory on ${new Date(f.created_at).toLocaleDateString()}`}
                >
                  <span className="text-ink/40">
                    {f.attribute.replace(/_/g, " ")}:
                  </span>{" "}
                  <span className="font-medium">{f.value}</span>
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Timeline */}
        <section className="mt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink/40">
            Timeline
          </h2>
          <ol className="space-y-3">
            {memories.map((m) => (
              <li
                key={m.id}
                className="rounded-xl border border-ink/5 bg-white p-4"
              >
                <div className="mb-1 flex items-center gap-2 text-xs text-ink/40">
                  <span className="rounded bg-ink/5 px-1.5 py-0.5 capitalize">
                    {m.kind}
                  </span>
                  <span>{new Date(m.occurred_at).toLocaleString()}</span>
                </div>
                <p className="text-sm text-ink/80">{m.content}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
