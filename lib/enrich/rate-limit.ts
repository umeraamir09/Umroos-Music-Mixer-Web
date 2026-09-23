// Shared throttling primitives for the enrichment providers.
//
// Every external music API in this pipeline has a different tolerance:
// ReccoBeats documents internal limits (429 + Retry-After), Last.fm bans
// burst traffic (error 29), and MusicBrainz hard-blocks IPs above one call
// per second. A token-bucket style spacing function plus a small circuit
// breaker keeps a broken or slow provider from stalling mix generation —
// every consumer fails open.

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type Waiter = () => Promise<void>;

// Serializes callers so successive waits are at least 1/perSecond apart.
// FIFO ordering is preserved through promise chaining, which matters for the
// 0.9/s MusicBrainz queue where hundreds of tracks line up behind references.
export function createRateLimiter(perSecond: number): Waiter {
  const intervalMs = 1000 / Math.max(0.05, perSecond);
  let nextAt = 0;
  let chain: Promise<void> = Promise.resolve();
  return async () => {
    const turn = chain.then(async () => {
      const now = Date.now();
      const at = Math.max(now, nextAt);
      nextAt = at + intervalMs;
      if (at > now) await sleep(at - now);
    });
    chain = turn.catch(() => undefined);
    return turn;
  };
}

// Waits for the seconds a provider asked for in `Retry-After` (falls back to
// fallbackMs when the header is absent or malformed).
export async function waitForRetryAfter(response: Response, fallbackMs = 1500): Promise<void> {
  const raw = response.headers.get("Retry-After");
  const seconds = raw ? Number(raw) : Number.NaN;
  await sleep(Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 30) * 1000 : fallbackMs);
}

export type Circuit = {
  /** Throws when the provider has failed repeatedly and is still cooling down. */
  check: () => void;
  success: () => void;
  failure: () => void;
};

// After `threshold` consecutive failures the circuit opens for `cooldownMs`
// (all calls short-circuit instead of stacking timeouts); once the cooldown
// passes, the next call is allowed through as a trial.
//
// Callers MUST invoke `check()` outside any catch block that reports failures
// (in practice: directly in the retry loop, before the `try`). If a thrown
// `check()` is caught and fed back into `failure()`, that increments the count
// and re-arms `openedAt`, so the cooldown restarts on every suppressed call —
// with steady traffic the breaker then never closes again and the provider
// stays unreachable for the lifetime of the process.
export function createCircuit(threshold = 3, cooldownMs = 30_000, now?: () => number): Circuit {
  // Resolve the clock per call rather than defaulting `now = Date.now` at
  // construction: a default parameter would capture whatever `Date.now` was
  // bound to when the module loaded, so an environment that swaps the clock
  // afterwards (vitest fake timers) would be invisible to the breaker and it
  // would measure cooldowns against the wrong timeline.
  const clock = (): number => (now ?? Date.now)();
  let failures = 0;
  let openedAt = 0;
  return {
    check() {
      if (failures >= threshold && clock() - openedAt < cooldownMs) {
        throw new Error(`enrichment provider circuit open (${failures} consecutive failures)`);
      }
    },
    success() {
      failures = 0;
    },
    failure() {
      failures += 1;
      openedAt = clock();
    },
  };
}
