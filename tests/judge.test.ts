import { describe, it, expect, beforeEach } from "vitest";
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import {
  __setJudgeClientForTests,
  findPersonSpans,
  resolvePersonName,
  routeIntent,
  scoreRelevance,
  verifyCitations,
} from "@/lib/judge";

// Fake SystemOne client: canned answers keyed by question id.
function fakeClient(
  answers: Record<string, unknown>,
  usage = { input_tokens: 100, output_tokens: 5 },
): TypeSafeClient {
  return {
    systemOne: async () => ({ answers, usage, model: "jev-test" }),
  } as unknown as TypeSafeClient;
}

function throwingClient(): TypeSafeClient {
  return {
    systemOne: async () => {
      throw new Error("relayer down");
    },
  } as unknown as TypeSafeClient;
}

beforeEach(() => {
  __setJudgeClientForTests(null);
});

describe("findPersonSpans (code-side pre-parse)", () => {
  it("finds names in verb contexts without the verb", () => {
    const spans = findPersonSpans("Met Sarah Chen at the AI meetup");
    expect(spans).toContain("Sarah Chen");
    expect(spans.every((s) => !/^met /i.test(s))).toBe(true);
  });

  it("over-finds: subjects and bigrams included for Jev to pick from", () => {
    const spans = findPersonSpans(
      "Lunch with David Okafor, CTO at Paystack. Said I'd intro him to Ravi.",
    );
    expect(spans).toContain("David Okafor");
  });

  it("returns no candidates for text without names", () => {
    expect(findPersonSpans("Had a great day at the park.")).toEqual([]);
  });
});

describe("routeIntent", () => {
  it("returns the routed intent with confidence", async () => {
    __setJudgeClientForTests(
      fakeClient({ intent: { choice: "recall", confidence: 0.92 } }),
    );
    const r = await routeIntent("Who is hiring React engineers?");
    expect(r).toMatchObject({ intent: "recall", confidence: 0.92 });
  });

  it("returns null when the judge fails (caller falls back)", async () => {
    __setJudgeClientForTests(throwingClient());
    expect(await routeIntent("hello")).toBeNull();
  });
});

describe("resolvePersonName", () => {
  it("returns the picked verbatim span (never invented)", async () => {
    __setJudgeClientForTests(
      fakeClient({ person: { choice: "David Okafor", confidence: 0.88 } }),
    );
    const r = await resolvePersonName("lunch with David Okafor", [
      "Ravi Menon",
      "David Okafor",
      "Ravi",
    ]);
    expect(r).toMatchObject({ name: "David Okafor", confidence: 0.88 });
  });

  it("maps the none hatch to null", async () => {
    __setJudgeClientForTests(
      fakeClient({ person: { choice: "none_of_these", confidence: 0.95 } }),
    );
    const r = await resolvePersonName("buy milk", ["Sarah Chen"]);
    expect(r).toMatchObject({ name: null });
  });

  it("returns null with no candidates (nothing to choose from)", async () => {
    __setJudgeClientForTests(fakeClient({}));
    expect(await resolvePersonName("hi", [])).toBeNull();
  });
});

describe("scoreRelevance", () => {
  it("sorts candidates by noul, highest first", async () => {
    __setJudgeClientForTests(
      fakeClient({ rel_0: { noul: 0.2 }, rel_1: { noul: 0.9 }, rel_2: { noul: 0.5 } }),
    );
    const out = await scoreRelevance("q", [
      { id: "a", text: "unrelated" },
      { id: "b", text: "the answer" },
      { id: "c", text: "somewhat related" },
    ]);
    expect(out?.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("returns null on failure so recall falls back", async () => {
    __setJudgeClientForTests(throwingClient());
    expect(await scoreRelevance("q", [{ id: "a", text: "x" }])).toBeNull();
  });
});

describe("verifyCitations", () => {
  it("maps supports/contradicts/says_nothing to verdicts", async () => {
    __setJudgeClientForTests(
      fakeClient({
        cite_0: { choice: "supports", confidence: 0.93 },
        cite_1: { choice: "contradicts", confidence: 0.99 },
        cite_2: { choice: "says_nothing", confidence: 0.4 },
      }),
    );
    const out = await verifyCitations([
      { id: "m1", claim: "Sarah hires", source: "Sarah is hiring" },
      { id: "m2", claim: "Sarah left", source: "Sarah joined" },
      { id: "m3", claim: "Sarah skis", source: "Sarah hires" },
    ]);
    expect(out?.m1?.verdict).toBe("verified");
    expect(out?.m2?.verdict).toBe("contradicted");
    expect(out?.m3?.verdict).toBe("unsupported");
  });

  it("returns {} for no items without calling", async () => {
    __setJudgeClientForTests(throwingClient());
    expect(await verifyCitations([])).toEqual({});
  });
});
