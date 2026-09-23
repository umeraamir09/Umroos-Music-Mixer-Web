// Pacing smoke tests for the enrichment providers (offline, always on).
//
// These assert the two guarantees the provider headers promise but the unit
// tests never measured end to end:
//   - MusicBrainz gets at most one request per second, including when callers
//     arrive concurrently and when a throttling response forces a retry;
//   - a provider's `Retry-After` is waited out in full. Coming back early is
//     the rate-limit violation that escalates into an IP block.
//
// The live counterparts (real providers, real clock) live in lib/smoke.test.ts
// behind LIVE_SMOKE=1.

import { afterEach, describe, expect, it, vi } from "vitest";
import { batchAudioFeatures } from "./reccobeats";
import { lookupIsrc, recordingTags, searchRecording } from "./musicbrainz";

const SPOTIFY_ID = "00aqkszH1FdUiJJWvX6iEl";
const ISRC = "USUM72104140";
const MBID = "3b64f8c0-9d43-4b2a-9e11-6b8f0e2f9a11";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Stubs fetch with scripted responses and records the start time of every request. */
function recordFetch(script: (request: number) => Response) {
  const stamps: number[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      stamps.push(Date.now());
      return script(stamps.length);
    }),
  );
  return stamps;
}

const gapsOf = (stamps: number[]) => stamps.slice(1).map((at, index) => at - stamps[index]);

describe("provider pacing smoke", () => {
  it("spaces concurrent MusicBrainz calls at one request per second", async () => {
    const stamps = recordFetch(() => json({ recordings: [{ id: MBID }], genres: [], tags: [] }));

    // Concurrent, because that is how a broken limiter would show up: callers
    // that all believe it is their turn.
    await Promise.all([lookupIsrc(ISRC), searchRecording("GHOST", "Yel"), recordingTags(MBID)]);

    expect(stamps).toHaveLength(3);
    const gaps = gapsOf(stamps);
    console.log("[smoke] musicbrainz gaps:", JSON.stringify(gaps));
    for (const gap of gaps) expect(gap, "MusicBrainz allows strictly one request per second").toBeGreaterThanOrEqual(1000);
  }, 20_000);

  it("waits out MusicBrainz's Retry-After in full before the single retry", async () => {
    const stamps = recordFetch((request) =>
      request === 1
        ? new Response("Service Unavailable", { status: 503, headers: { "Retry-After": "2" } })
        : json({ recordings: [{ id: MBID }] }),
    );

    expect(await lookupIsrc(ISRC)).toBe(MBID);

    const gap = gapsOf(stamps)[0];
    console.log("[smoke] musicbrainz 503 backoff:", gap, "ms (server asked 2000)");
    expect(gap, "the retry must not come back before the server asked it to").toBeGreaterThanOrEqual(2000);
  }, 20_000);

  it("waits out ReccoBeats' Retry-After on a 429", async () => {
    // The limiter alone would retry after ~667ms, so this only passes when the
    // header (1s) is actually honored.
    const stamps = recordFetch((request) =>
      request === 1
        ? new Response("Too Many Requests", { status: 429, headers: { "Retry-After": "1" } })
        : json({ content: [{ href: `https://open.spotify.com/track/${SPOTIFY_ID}`, energy: 0.7 }] }),
    );

    const features = await batchAudioFeatures([SPOTIFY_ID]);

    expect(features.get(SPOTIFY_ID)?.energy).toBe(0.7);
    const gap = gapsOf(stamps)[0];
    console.log("[smoke] reccobeats 429 backoff:", gap, "ms (server asked 1000)");
    expect(gap).toBeGreaterThanOrEqual(1000);
  }, 20_000);

  it("paces a multi-chunk ReccoBeats batch at its documented 1.5/s", async () => {
    const stamps = recordFetch(() => json({ content: [] }));
    const ids = Array.from({ length: 45 }, (_, index) => `000000${index}`.padStart(22, "A"));

    await batchAudioFeatures(ids);

    expect(stamps).toHaveLength(2);
    const gap = gapsOf(stamps)[0];
    console.log("[smoke] reccobeats chunk gap:", gap, "ms (limit ~667)");
    expect(gap).toBeGreaterThanOrEqual(600);
  }, 20_000);
});
