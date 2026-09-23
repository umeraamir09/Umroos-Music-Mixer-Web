// Circuit-breaker smoke tests (offline, always on).
//
// A breaker that cannot close again is worse than no breaker: once a provider
// has failed `threshold` times, every later call is rejected locally with
// "circuit open" and no request is ever sent — so a single bad minute turns
// into ReccoBeats (or MusicBrainz, or Last.fm) failing for the rest of the
// process's life. That is exactly the "fetches keep failing" symptom: the
// provider is healthy again but the client never asks it.
//
// Real timers would need the 30s cooldown, so fake time drives the clock while
// calls keep arriving — which is the condition that used to re-arm the
// cooldown forever.
//
// Regression: `circuit.check()` must sit outside the failure-reporting catch
// (see rate-limit.ts); counting a short circuit as a failure re-arms `openedAt`
// on every suppressed call and the trial never happens.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { batchAudioFeatures } from "./reccobeats";
import { lookupIsrc } from "./musicbrainz";
import { trackTopTags } from "./lastfm";

const SPOTIFY_ID = "00aqkszH1FdUiJJWvX6iEl";
const ISRC = "USUM72104140";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

type Outcome = { ok: true } | { ok: false; error: string };

/** Runs a client call to settlement while fake time moves, so queued waits and cooldowns elapse. */
async function settle(promise: Promise<unknown>): Promise<Outcome> {
  const box: { outcome?: Outcome } = {};
  promise.then(
    () => { box.outcome = { ok: true }; },
    (error) => { box.outcome = { ok: false, error: error instanceof Error ? error.message : String(error) }; },
  );
  for (let guard = 0; guard < 4000 && !box.outcome; guard += 1) {
    await vi.advanceTimersByTimeAsync(25);
  }
  if (!box.outcome) throw new Error("call never settled while fake time advanced");
  return box.outcome;
}

const providers = [
  {
    name: "ReccoBeats",
    setup: () => {},
    healthy: () => json({ content: [] }),
    call: () => batchAudioFeatures([SPOTIFY_ID]),
  },
  {
    name: "MusicBrainz",
    setup: () => {},
    healthy: () => json({ recordings: [] }),
    call: () => lookupIsrc(ISRC),
  },
  {
    name: "Last.fm",
    setup: () => vi.stubEnv("LASTFM_API_KEY", "circuit-smoke-key"),
    healthy: () => json({ toptags: { tag: [] } }),
    call: () => trackTopTags({ track: "GHOST", artist: "Yel" }),
  },
];

describe.each(providers)("circuit breaker smoke: $name", ({ name, setup, healthy, call }) => {
  beforeEach(() => {
    vi.useFakeTimers();
    setup();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reopens after the cooldown even while calls keep arriving", async () => {
    let mode: "down" | "up" = "down";
    const fetchMock = vi.fn(async () => (mode === "down" ? new Response("boom", { status: 500 }) : healthy()));
    vi.stubGlobal("fetch", fetchMock);

    // Three consecutive provider failures open the breaker.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const outcome = await settle(call());
      expect(outcome.ok, `${name} should surface its outage (got: ${JSON.stringify(outcome)})`).toBe(false);
    }
    const openingFetches = fetchMock.mock.calls.length;
    expect(openingFetches, "two attempts per failing call").toBe(6);

    // The provider recovers, but a long-lived server keeps calling — well
    // inside the cooldown window. The breaker must still let a trial through.
    mode = "up";
    let lastError = "";
    let recovered = false;
    for (let elapsed = 0; elapsed < 120_000 && !recovered; elapsed += 10_000) {
      await vi.advanceTimersByTimeAsync(10_000);
      const outcome = await settle(call());
      recovered = outcome.ok;
      if (!outcome.ok) lastError = outcome.error;
    }

    console.log(`[smoke] ${name} circuit: recovered=${recovered} blockedWith=${JSON.stringify(lastError)} trialFetches=${fetchMock.mock.calls.length - openingFetches}`);
    expect(recovered, `${name} circuit never closed again while calls kept arriving (last error: ${lastError})`).toBe(true);
    expect(fetchMock.mock.calls.length, "the trial must reach the provider").toBeGreaterThan(openingFetches);
  }, 30_000);
});
