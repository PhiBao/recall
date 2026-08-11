import { describe, it, expect } from "vitest";
import { isRealEmbedding } from "@/lib/ai";

describe("isRealEmbedding", () => {
  it("returns false for a tiny vector", () => {
    expect(isRealEmbedding([0.1, 0.2, 0.3])).toBe(false);
  });

  it("returns false for the hash fallback (few distinct values)", () => {
    const v = new Array(1024).fill(0);
    v[0] = 0.5;
    v[1] = 0.5;
    expect(isRealEmbedding(v)).toBe(false);
  });

  it("returns true for a high-cardinality vector (real model output)", () => {
    const v = Array.from({ length: 1024 }, (_, i) => Math.sin(i * 0.13));
    expect(isRealEmbedding(v)).toBe(true);
  });
});
