// MusicBrainz client — https://musicbrainz.org/doc/MusicBrainz_API
//
// Role in the pipeline: identity fallback + curated genres. Last.fm is
// queried first with Spotify-canonical track/artist strings; when that
// string identity cannot confirm a recording, an ISRC (free from Reccobeats)
// resolves to a recording MBID, and the MBID both anchors the Last.fm
// `mbid=` fallback lookup (no more artist/title ambiguity) and unlocks
// MusicBrainz's curated genre list plus free-form tags.
//
// Constraints (hard):
//   - ONE request per second per IP (token-bucket at 0.9/s; violations risk
//     an IP block, so the limiter runs before every request).
//   - A meaningful User-Agent is mandatory (MUSICBRAINZ_AGENT overrides).
//   - `inc=genres` is invalid on the `/isrc` resource (verified live), so an
//     ISRC lookup is a two-step: isrc -> mbid, then recording lookup with
//     `inc=genres+tags`.
// Results are cached (lib/enrich/cache.ts) so each track pays this cost once.

import { createCircuit, createRateLimiter, waitForRetryAfter } from "./rate-limit";
import type { TagCount } from "./tags";

const ROOT = "https://musicbrainz.org/ws/2";
const TIMEOUT_MS = 10_000;
const MIN_SEARCH_SCORE = 90;

const wait = createRateLimiter(0.9);
const circuit = createCircuit();

function agent(): string {
  return process.env.MUSICBRAINZ_AGENT?.trim() || "UmroosMusicMixer/0.1 (personal playlist tool; enrichment)";
}

// Carries the HTTP status so callers can tell a genuine miss (404/400) from
// an outage — misses are negative-cached, outages must be retried next run.
class HttpStatusError extends Error {
  constructor(readonly status: number, body: string) {
    super(`MusicBrainz HTTP ${status}: ${body}`);
  }
}

const isMiss = (error: unknown) => error instanceof HttpStatusError && (error.status === 404 || error.status === 400);

async function get(path: string): Promise<Record<string, unknown>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // Outside the catch: being short-circuited is not a provider failure, and
    // counting it would re-arm the cooldown forever (see rate-limit.ts).
    circuit.check();
    try {
      await wait();
      const response = await fetch(`${ROOT}${path}`, {
        headers: { "User-Agent": agent(), Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      // 429/503 means "slow down". Waiting the seconds the server asked for
      // is the whole game here: coming back early is precisely the rate-limit
      // violation that escalates into an IP block. One retry, then give up.
      if ((response.status === 429 || response.status === 503) && attempt === 0) {
        await waitForRetryAfter(response);
        continue;
      }
      if (!response.ok) throw new HttpStatusError(response.status, (await response.text()).slice(0, 160));
      const data = (await response.json()) as Record<string, unknown>;
      circuit.success();
      return data;
    } catch (error) {
      lastError = error;
      if (attempt > 0 || isMiss(error)) {
        if (!isMiss(error)) circuit.failure();
        throw error;
      }
    }
  }
  circuit.failure();
  throw lastError instanceof Error ? lastError : new Error("MusicBrainz request failed");
}

/** ISRC -> recording MBID (first recording wins; null when genuinely unknown). */
export async function lookupIsrc(isrc: string): Promise<string | null> {
  try {
    const data = await get(`/isrc/${encodeURIComponent(isrc)}?fmt=json`);
    const recordings = Array.isArray(data.recordings) ? (data.recordings as Record<string, unknown>[]) : [];
    const mbid = recordings[0]?.id;
    return typeof mbid === "string" && mbid ? mbid : null;
  } catch (error) {
    if (isMiss(error)) return null;
    throw error;
  }
}

/** Title+artist search fallback -> high-confidence recording MBID. */
export async function searchRecording(title: string, artist: string): Promise<string | null> {
  const query = `recording:"${title.replace(/"/g, "")}" AND artist:"${artist.replace(/"/g, "")}"`;
  const data = await get(`/recording?query=${encodeURIComponent(query)}&limit=1&fmt=json`);
  const recordings = Array.isArray(data.recordings) ? (data.recordings as Record<string, unknown>[]) : [];
  const hit = recordings[0];
  const score = Number(hit?.score ?? 0);
  const mbid = hit?.id;
  // Below ~90 we cannot trust the identity; a wrong mbid would mislabel
  // genres, so callers fall back to name-based Last.fm lookups instead.
  return typeof mbid === "string" && mbid && score >= MIN_SEARCH_SCORE ? mbid : null;
}

export type RecordingTags = { genres: TagCount[]; tags: TagCount[] };

function asTagCount(value: unknown): TagCount[] {
  if (!Array.isArray(value)) return [];
  return (value as Record<string, unknown>[])
    .map((entry) => ({ name: String(entry?.name ?? ""), count: Number(entry?.count ?? 0) }))
    .filter((entry) => entry.name);
}

/** Curated genres + free-form tags for a recording (`inc=genres+tags`). */
export async function recordingTags(mbid: string): Promise<RecordingTags> {
  try {
    const data = await get(`/recording/${encodeURIComponent(mbid)}?inc=genres+tags&fmt=json`);
    return { genres: asTagCount(data.genres), tags: asTagCount(data.tags) };
  } catch (error) {
    if (isMiss(error)) return { genres: [], tags: [] };
    throw error;
  }
}
