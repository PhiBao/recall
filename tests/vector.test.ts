import { describe, it, expect } from "vitest";
import { toVectorLiteral } from "@/lib/db";

describe("toVectorLiteral", () => {
  it("formats a number array as a CockroachDB vector literal", () => {
    expect(toVectorLiteral([0.1, 0.2, -0.3])).toBe("[0.1,0.2,-0.3]");
  });

  it("handles empty arrays", () => {
    expect(toVectorLiteral([])).toBe("[]");
  });

  it("replaces non-finite values with 0", () => {
    expect(toVectorLiteral([1, NaN, Infinity, -Infinity, 2])).toBe(
      "[1,0,0,0,2]",
    );
  });

  it("rounds to full float precision", () => {
    expect(toVectorLiteral([0.123456789])).toBe("[0.123456789]");
  });
});
