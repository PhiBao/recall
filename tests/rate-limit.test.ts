import { describe, it, expect, vi, beforeEach } from "vitest";
import { RateLimiter } from "@/lib/rate-limit";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("allows up to capacity requests in a window", () => {
    const rl = new RateLimiter(3, 1000);
    const now = Date.now();
    expect(rl.check("a", now)).toBe(true);
    expect(rl.check("a", now)).toBe(true);
    expect(rl.check("a", now)).toBe(true);
    expect(rl.check("a", now)).toBe(false); // 4th is throttled
  });

  it("refills after the window passes", () => {
    const rl = new RateLimiter(1, 100);
    const t0 = Date.now();
    expect(rl.check("a", t0)).toBe(true);
    expect(rl.check("a", t0)).toBe(false);
    expect(rl.check("a", t0 + 101)).toBe(true); // window reset
  });

  it("tracks keys independently", () => {
    const rl = new RateLimiter(1, 1000);
    const now = Date.now();
    expect(rl.check("a", now)).toBe(true);
    expect(rl.check("b", now)).toBe(true);
    expect(rl.check("a", now)).toBe(false);
  });

  it("sweep removes expired buckets", () => {
    const rl = new RateLimiter(1, 100);
    rl.check("a", 0);
    rl.check("b", 0);
    rl.sweep(101);
    // After sweep, both keys are gone — fresh capacity on next check.
    expect(rl.check("a", 102)).toBe(true);
  });
});
