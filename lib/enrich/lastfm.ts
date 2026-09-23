// Last.fm client — https://www.last.fm/api
//
// Read-only methods need only an API key (LASTFM_API_KEY); no user session.
// Every track method accepts either `artist+track` (with `autocorrect=1`) or a
// MusicBrainz `mbid`. The pipeline prefers the first form, fed with
// Spotify-canonical track/artist strings, and only falls back to an mbid when
// the string identity cannot confirm the recording. We deliberately never
// store `listeners`/`playcount`: popularity stays hidden from Jev, matching
// the judging rubric.
//
// Endpoints used:
//   track.getTopTags  -> community tags with counts (genre/mood evidence)
//   track.getInfo     -> toptags + wiki summary (vibe description)
//   track.getSimilar  -> similar tracks with match scores (reference evidence
//                        and retrieval queries)
//   tag.getInfo       -> definition of a plan term (consistent interpretation)
//
// `track.getTags` is intentionally NOT used: it returns one specific user's
// tags (requires a username or auth session); `getTopTags` is the global
// equivalent. Rate pacing ~4/s with one retry on error 29 / HTTP 429.

import { compactText } from "@/lib/utils";
import { createCircuit, createRateLimiter, waitForRetryAfter } from "./rate-limit";
import type { TagCount } from "./tags";

const ROOT = "https://ws.audioscrobbler.com/2.0/";
const TIMEOUT_MS = 8000;
const AGENT = "UmroosMusicMixer/0.1 (enrichment client)";

export type TrackRef = { mbid?: string; track?: string; artist?: string };

export type TrackDetails = { tags: TagCount[]; summary?: string };

export type SimilarTrack = { title: string; artist: string; match: number };

const wait = createRateLimiter(4);
const circuit = createCircuit();
class SlowRetryError extends Error {}

export function hasLastfm(): boolean {
  return Boolean(process.env.LASTFM_API_KEY?.trim());
}

function identityParams(ref: TrackRef): Record<string, string> {
  if (ref.mbid) return { mbid: ref.mbid };
  return { track: ref.track || "", artist: ref.artist || "", autocorrect: "1" };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function call(params: Record<string, string>): Promise<Record<string, unknown> | null> {
  if (!hasLastfm()) return null;
  const url = new URL(ROOT);
  url.searchParams.set("format", "json");
  url.searchParams.set("api_key", process.env.LASTFM_API_KEY!.trim());
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // Outside the catch: a short-circuited call is not a provider failure, and
    // counting it would re-arm the cooldown forever (see rate-limit.ts).
    circuit.check();
    try {
      await wait();
      const response = await fetch(url.toString(), {
        headers: { "User-Agent": AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      // Header-bearing HTTP 429s defer to the server's instruction; the JSON
      // error-29 shape below has no headers, so it keeps the fixed pause.
      if (response.status === 429 && attempt === 0) {
        const retrySeconds = Number(response.headers.get("Retry-After"));
        if (Number.isFinite(retrySeconds) && retrySeconds > 5) throw new SlowRetryError("Last.fm requested a long cooldown");
        await waitForRetryAfter(response);
        continue;
      }
      if (!response.ok && response.status >= 500) throw new Error(`Last.fm ${response.status}`);
      const data = (await response.json()) as Record<string, unknown>;
      const apiError = Number(data.error);
      if (Number.isFinite(apiError)) {
        // 29 = rate limited (retryable); anything else (missing resource,
        // invalid params) is a legitimate "not found" for this provider.
        if (apiError === 29 && attempt === 0) {
          await sleep(1500);
          continue;
        }
        if (apiError === 29) throw new Error("Last.fm rate limited");
        circuit.success();
        return null;
      }
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
  throw lastError instanceof Error ? lastError : new Error("Last.fm request failed");
}

function asTagList(value: unknown): TagCount[] {
  if (!Array.isArray(value)) return [];
  return (value as Record<string, unknown>[])
    .map((tag) => ({ name: String(tag?.name ?? ""), count: Number(tag?.count ?? 0) }))
    .filter((tag) => tag.name);
}

export function stripHtml(text: string | undefined): string {
  if (!text) return "";
  return compactText(
    text
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim(),
    140,
  );
}

/** Community tags with counts (primary genre/mood source). */
export async function trackTopTags(ref: TrackRef): Promise<TagCount[]> {
  const data = await call({ method: "track.getTopTags", ...identityParams(ref) });
  return asTagList(data?.toptags && typeof data.toptags === "object" ? (data.toptags as Record<string, unknown>).tag : undefined);
}

/** toptags + a compact editorial summary of the recording (the "vibe" text). */
export async function trackInfo(ref: TrackRef): Promise<TrackDetails | null> {
  const data = await call({ method: "track.getInfo", ...identityParams(ref) });
  const track = data?.track && typeof data.track === "object" ? (data.track as Record<string, unknown>) : null;
  if (!track) return null;
  const wiki = track.wiki && typeof track.wiki === "object" ? (track.wiki as Record<string, unknown>) : null;
  const summary = stripHtml(wiki?.summary ? String(wiki.summary) : undefined) || undefined;
  const tags = asTagList(track.toptags && typeof track.toptags === "object" ? (track.toptags as Record<string, unknown>).tag : undefined);
  if (!tags.length && !summary) return null;
  return { tags, summary };
}

/**
 * Similar tracks from listening data. Match scales vary across responses
 * (docs show values above 1), so scores are normalized to 0..1 against the
 * strongest entry in each response.
 */
export async function trackSimilar(ref: TrackRef, limit = 50): Promise<SimilarTrack[]> {
  const data = await call({ method: "track.getSimilar", limit: String(limit), ...identityParams(ref) });
  const list = data?.similartracks && typeof data.similartracks === "object" ? (data.similartracks as Record<string, unknown>).track : undefined;
  if (!Array.isArray(list)) return [];
  const parsed = (list as Record<string, unknown>[])
    .map((entry) => {
      const artist = entry?.artist && typeof entry.artist === "object" ? String((entry.artist as Record<string, unknown>).name ?? "") : "";
      const match = Number(entry?.match);
      return { title: String(entry?.name ?? ""), artist: artist.trim(), match: Number.isFinite(match) ? match : 0 };
    })
    .filter((entry) => entry.title && entry.artist);
  const max = Math.max(0, ...parsed.map((entry) => entry.match));
  if (max <= 0) return [];
  return parsed.map((entry) => ({ ...entry, match: Math.round((max > 1 ? entry.match / max : entry.match) * 100) / 100 }));
}

/** Compact definition of a tag so plan terms (genres/avoidTraits) are interpreted consistently. */
export async function tagInfo(tag: string): Promise<string | null> {
  const data = await call({ method: "tag.getInfo", tag });
  const node = data?.tag && typeof data.tag === "object" ? (data.tag as Record<string, unknown>) : null;
  const wiki = node?.wiki && typeof node.wiki === "object" ? (node.wiki as Record<string, unknown>) : null;
  const summary = stripHtml(wiki?.summary ? String(wiki.summary) : undefined) || undefined;
  return summary ? compactText(summary, 160) : null;
}
