// ReccoBeats client — https://reccobeats.com/docs/apis/reccobeats-api
//
// Free, no API key. The batch endpoints (`/audio-features`, `/track`,
// `/track/recommendation`) accept Spotify IDs directly, which makes it the
// primary numeric enrichment source: full audio analysis + ISRC in one
// request per 40 tracks. The single-track paths require ReccoBeats UUIDs, so
// this module only uses batch endpoints. Verified live during planning:
//   - GET /v1/audio-features?ids=a,b,c  -> { content: [{ href, isrc, energy, ... }] }
//   - GET /v1/track?ids=a,b             -> { content: [{ trackTitle, isrc, ... }] }
//   - GET /v1/track/recommendation?seeds=a&size=40
//   - GET /v1/track/search?searchText=...
// Rate limits are internal (429 + Retry-After); we pace at 1.5/s.

import { chunk } from "@/lib/utils";
import { createCircuit, createRateLimiter, waitForRetryAfter } from "./rate-limit";

const API = "https://api.reccobeats.com/v1";
const TIMEOUT_MS = 8000;
const BATCH_SIZE = 40;

export type ReccoFeatures = {
  spotifyId: string;
  isrc?: string;
  acousticness?: number;
  danceability?: number;
  energy?: number;
  instrumentalness?: number;
  liveness?: number;
  loudness?: number;
  speechiness?: number;
  tempo?: number;
  valence?: number;
};

export type ReccoTrack = {
  spotifyId: string;
  title: string;
  artists: string[];
  durationMs: number;
  isrc?: string;
};

const wait = createRateLimiter(1.5);
const circuit = createCircuit();
class SlowRetryError extends Error {}

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// Resource hrefs are canonical Spotify URLs ("https://open.spotify.com/track/XXX").
export function spotifyIdFromHref(href: string | undefined): string | null {
  if (!href) return null;
  const segment = href.split("?")[0].split("/").filter(Boolean).pop();
  return segment && /^[A-Za-z0-9]{22}$/.test(segment) ? segment : null;
}

async function get(path: string): Promise<Record<string, unknown>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // Outside the catch: a short-circuited call never reaches the provider, so
    // it must not be recorded as a failure. Otherwise `failure()` re-arms the
    // cooldown on every suppressed call and the breaker never closes while
    // traffic keeps arriving — the provider then stays dead until restart.
    circuit.check();
    try {
      await wait();
      const response = await fetch(`${API}${path}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (response.status === 429 && attempt === 0) {
        const retrySeconds = Number(response.headers.get("Retry-After"));
        if (Number.isFinite(retrySeconds) && retrySeconds > 5) throw new SlowRetryError("ReccoBeats requested a long cooldown");
        await waitForRetryAfter(response);
        continue;
      }
      if (!response.ok) throw new Error(`ReccoBeats ${response.status}: ${(await response.text()).slice(0, 200)}`);
      const data = (await response.json()) as Record<string, unknown>;
      circuit.success();
      return data;
    } catch (error) {
      lastError = error;
      if (attempt > 0 || error instanceof SlowRetryError) {
        circuit.failure();
        throw error;
      }
    }
  }
  circuit.failure();
  throw lastError instanceof Error ? lastError : new Error("ReccoBeats request failed");
}

function parseTrack(item: Record<string, unknown>): ReccoTrack | null {
  const spotifyId = spotifyIdFromHref(item.href as string | undefined);
  if (!spotifyId) return null;
  const artists = Array.isArray(item.artists)
    ? (item.artists as Record<string, unknown>[]).map((artist) => String(artist?.name || "").trim()).filter(Boolean)
    : [];
  if (!artists.length) return null;
  return {
    spotifyId,
    title: String(item.trackTitle || "").trim(),
    artists,
    durationMs: numberOrUndefined(item.durationMs) ?? 0,
    isrc: typeof item.isrc === "string" && item.isrc ? item.isrc : undefined,
  };
}

function contentOf(data: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(data.content) ? (data.content as Record<string, unknown>[]) : [];
}

/** Batch audio features for Spotify IDs in chunks of 40. Unknown IDs are simply absent from the map. */
export async function batchAudioFeatures(ids: string[]): Promise<Map<string, ReccoFeatures>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const results = new Map<string, ReccoFeatures>();
  const batches = await Promise.allSettled(chunk(unique, BATCH_SIZE).map((group) =>
    get(`/audio-features?ids=${encodeURIComponent(group.join(","))}`),
  ));
  if (batches.length && batches.every((batch) => batch.status === "rejected")) {
    throw (batches[0] as PromiseRejectedResult).reason;
  }
  for (const batch of batches) {
    if (batch.status !== "fulfilled") continue;
    const data = batch.value;
    for (const item of contentOf(data)) {
      const spotifyId = spotifyIdFromHref(item.href as string | undefined);
      if (!spotifyId) continue;
      results.set(spotifyId, {
        spotifyId,
        isrc: typeof item.isrc === "string" && item.isrc ? item.isrc : undefined,
        acousticness: numberOrUndefined(item.acousticness),
        danceability: numberOrUndefined(item.danceability),
        energy: numberOrUndefined(item.energy),
        instrumentalness: numberOrUndefined(item.instrumentalness),
        liveness: numberOrUndefined(item.liveness),
        loudness: numberOrUndefined(item.loudness),
        speechiness: numberOrUndefined(item.speechiness),
        tempo: numberOrUndefined(item.tempo),
        valence: numberOrUndefined(item.valence),
      });
    }
  }
  return results;
}

/** Seed-track recommendations (Spotify-ID seeds, size ≤ 100). */
export async function recommend(seeds: string[], size = 40): Promise<ReccoTrack[]> {
  const params = new URLSearchParams();
  [...new Set(seeds.filter(Boolean))].slice(0, 5).forEach((seed) => params.append("seeds", seed));
  params.set("size", String(Math.min(100, Math.max(1, size))));
  const data = await get(`/track/recommendation?${params.toString()}`);
  return contentOf(data).map(parseTrack).filter((track): track is ReccoTrack => Boolean(track?.title));
}

/** Free-text catalog search. The required parameter is `searchText` (verified live). */
export async function searchTracks(text: string, limit = 10): Promise<ReccoTrack[]> {
  const data = await get(`/track/search?searchText=${encodeURIComponent(text)}`);
  return contentOf(data).map(parseTrack).filter((track): track is ReccoTrack => Boolean(track?.title)).slice(0, limit);
}
