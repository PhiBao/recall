/**
 * Minimal in-memory rate limiter (token bucket, per key).
 *
 * Scope: a single Node process. That's the right granularity for a demo and
 * for a single-instance App Runner deployment; a multi-instance deployment
 * would swap this for a Redis/CRDB-backed counter without changing the
 * interface. The point is to prove the integration point exists and behaves —
 * not to build a distributed limiter.
 */
export class RateLimiter {
  private tokens = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillIntervalMs: number,
  ) {}

  /** Returns true if the request is allowed, false if it should be throttled. */
  check(key: string, now = Date.now()): boolean {
    let entry = this.tokens.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: this.capacity, resetAt: now + this.refillIntervalMs };
      this.tokens.set(key, entry);
    }
    if (entry.count <= 0) return false;
    entry.count--;
    return true;
  }

  /** Drop expired buckets so the map doesn't grow without bound. */
  sweep(now = Date.now()): void {
    for (const [k, v] of this.tokens) {
      if (now >= v.resetAt) this.tokens.delete(k);
    }
  }
}

// Capture/recall are the user-facing write/read paths. Allow a generous but
// bounded rate per user so a runaway client (or a misbehaving script) can't
// exhaust Bedrock quota or spam the DB.
export const userActionLimiter = new RateLimiter(
  30, // tokens
  60_000, // refill window = 1 minute → 30 req/min/user
);
