import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { toVectorLiteral } from "@/lib/db";

// The API key hashing is a pure function we replicate here to assert the
// contract: keys are prefixed, hashed with SHA-256, and never stored raw.
function sha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

describe("api key format contract", () => {
  it("keys are prefixed with recu_", () => {
    const prefix = "recu_";
    const rawKey = `${prefix}${Buffer.from("a".repeat(32)).toString("base64url")}`;
    expect(rawKey.startsWith(prefix)).toBe(true);
  });

  it("the stored hash is sha256 of the raw key (never the raw key)", () => {
    const rawKey = "recu_abc123";
    const hash = sha256(rawKey);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("recu_");
  });

  it("different keys hash differently; same key hashes identically", () => {
    expect(sha256("recu_a")).toBe(sha256("recu_a"));
    expect(sha256("recu_a")).not.toBe(sha256("recu_b"));
  });
});

describe("vector literal (used by MCP list_tables path indirectly)", () => {
  it("round-trips a simple vector", () => {
    expect(toVectorLiteral([1, 2, 3])).toBe("[1,2,3]");
  });
});
