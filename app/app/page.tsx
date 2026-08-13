import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import {
  getTodayFeed,
  listPeople,
  recentMemories,
} from "@/lib/memory";
import { listApiKeys } from "@/lib/api-keys";
import { signOutAction } from "../actions";
import { Composer } from "@/components/Composer";
import { TodayCard } from "@/components/TodayCard";
import { ApiKeysPanel } from "@/components/ApiKeysPanel";

export default async function AppPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const [today, people, recent, keys] = await Promise.all([
    getTodayFeed(user.id),
    listPeople(user.id),
    recentMemories(user.id, 8),
    listApiKeys(user.id),
  ]);

  const firstName = user.name?.split(" ")[0] ?? "there";

  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-6 py-8 lg:grid-cols-[1fr_360px]">
        {/* Left: capture + recall conversation */}
        <section className="flex flex-col">
          <header className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">🪳</span>
              <span className="font-semibold tracking-tight">Recall</span>
            </div>
            <form action={signOutAction}>
              <button className="text-sm text-ink/50 hover:text-ink">
                Sign out
              </button>
            </form>
          </header>

          <div className="mb-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Hi {firstName}.
            </h1>
            <p className="mt-1 text-ink/60">
              Tell me who you met, or ask me about anyone you know.
            </p>
          </div>

          <Composer hasPeople={people.length > 0} />

          {recent.length > 0 && (
            <div className="mt-8">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink/40">
                Recently remembered
              </h2>
              <ul className="space-y-2">
                {recent.map((m) => (
                  <li
                    key={m.id}
                    className="rounded-xl border border-ink/5 bg-white p-3 text-sm"
                  >
                    {m.person_name && (
                      <Link
                        href={`/app/person/${m.person_id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {m.person_name}
                      </Link>
                    )}
                    <span className="text-ink/70">
                      {m.person_name ? " — " : ""}
                      {m.content.slice(0, 140)}
                      {m.content.length > 140 ? "…" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Right: Today feed + people */}
        <aside className="flex flex-col gap-8">
          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink/40">
              Today · follow up
            </h2>
            {today.length === 0 ? (
              <p className="rounded-xl border border-dashed border-ink/15 p-4 text-sm text-ink/50">
                Nothing due. When you promise to follow up with someone, it
                shows up here.
              </p>
            ) : (
              <div className="space-y-3">
                {today.map((item) => (
                  <TodayCard key={item.commitment.id} item={item} />
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink/40">
              People ({people.length})
            </h2>
            {people.length === 0 ? (
              <p className="text-sm text-ink/50">No one yet.</p>
            ) : (
              <ul className="space-y-1">
                {people.slice(0, 12).map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/app/person/${p.id}`}
                      className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-white"
                    >
                      <span className="font-medium">{p.name}</span>
                      {p.headline && (
                        <span className="truncate pl-3 text-xs text-ink/40">
                          {p.headline}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <ApiKeysPanel keys={keys} />
        </aside>
      </div>
    </main>
  );
}
