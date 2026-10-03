import { describe, it, expect } from "vitest";
import { findPersonSpans } from "@/lib/judge";

/**
 * Regression battery for the candidate pre-parser.
 *
 * Context: in production a single capture — "i meet Thomaz, he is a funny
 * person" — produced a memory with NO person, NO facts and NO commitments.
 * The cause was a narrow regex gate: when the pre-parser found no name, the
 * system never even asked Jev, and silently dropped the whole relationship
 * record. Over-finding is therefore mandatory; Jev selects from the options.
 *
 * These cases are the real-world phrasings that broke it.
 */
const CASES: { text: string; expect: string[] }[] = [
  { text: "i meet Thomaz, he is a funny person", expect: ["Thomaz"] },
  { text: "saw Priya today - she's hiring at Vercel", expect: ["Priya"] },
  { text: "grabbed coffee w/ Marcus", expect: ["Marcus"] },
  { text: "Tomás Silva runs growth at Loop", expect: ["Tomás Silva"] },
  { text: "DM'd Aisha about the design stuff", expect: ["Aisha"] },
  { text: "quick one - met up w/ Dr. Lena Ortiz", expect: ["Dr. Lena Ortiz"] },
  { text: "hung out with Ravi + Tomás in the park", expect: ["Ravi", "Tomás"] },
  { text: "Lunch with David Okafor, CTO at Paystack", expect: ["David Okafor"] },
  { text: "just caught up w/ the Sequoia partner, Marc", expect: ["Marc"] },
  { text: "My neighbor Sam is a chef", expect: ["Sam"] },
  { text: "emailed the recruiter, Nadia said to wait", expect: ["Nadia"] },
];

describe("findPersonSpans — never silently gate", () => {
  for (const c of CASES) {
    it(`finds a name in: "${c.text.slice(0, 44)}"`, () => {
      const spans = findPersonSpans(c.text);
      for (const want of c.expect) {
        expect(spans).toContain(want);
      }
    });
  }

  it("does not treat the particle in 'met up w/' as a name", () => {
    // Regression: an earlier pattern matched "up" as a person.
    const spans = findPersonSpans("quick one - met up w/ Dr. Lena Ortiz");
    expect(spans.some((s) => s.toLowerCase() === "up")).toBe(false);
  });

  it("does not glue trailing lowercase words into the span", () => {
    // Regression: /i on the verb pattern produced "Priya today".
    const spans = findPersonSpans("saw Priya today - she's hiring at Vercel");
    expect(spans.some((s) => /today/i.test(s))).toBe(false);
  });

  it("returns nothing for text with no people", () => {
    expect(findPersonSpans("had a great day at the park walking the dog")).toEqual([]);
    expect(findPersonSpans("remind me to buy milk")).toEqual([]);
  });

  it("dedupes case-insensitively and preserves order", () => {
    const spans = findPersonSpans("Met Sarah. Then met SARAH again with Priya.");
    const lowered = spans.map((s) => s.toLowerCase());
    expect(lowered.indexOf("sarah")).toBe(lowered.lastIndexOf("sarah"));
  });
});
