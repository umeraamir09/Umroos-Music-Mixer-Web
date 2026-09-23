// Durable enrichment cache.
//
// Two layers: a process-local Map (always on, survives within one server
// process) and a Convex `enrichmentCache` table (when CONVEX_URL is
// configured) so the ~1 MusicBrainz request/second cost and the Last.fm/ReccoBeats
// metadata are paid once per track, not once per mix. Reads and writes are
// best-effort: a cache outage must never fail mix generation.

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { MixTrack } from "@/lib/types";
import { chunk } from "@/lib/utils";

const TTL_MS = 90 * 24 * 60 * 60 * 1000;

export type CacheSimilar = { title: string; artist: string; match: number };

/** Negative-cache markers: the provider was asked (per identity) and had nothing. */
export type CacheTried = { lastfm?: boolean; lastfmMbid?: boolean; musicbrainz?: boolean };

export type CacheEntry = {
  key: string;
  isrc?: string;
  mbid?: string;
  genres?: string[];
  tags?: string[];
  summary?: string;
  features?: Record<string, number>;
  similar?: CacheSimilar[];
  /** Negative-cache markers: the provider was asked and had nothing. */
  tried?: CacheTried;
  updatedAt: number;
};

const memory = new Map<string, CacheEntry>();

const getRef = makeFunctionReference<"query", { keys: string[] }, CacheEntry[]>("enrichmentCache:getMany");
const putRef = makeFunctionReference<"mutation", { entries: CacheEntry[] }, number>("enrichmentCache:putMany");

function convex(): ConvexHttpClient | null {
  const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  return url ? new ConvexHttpClient(url) : null;
}

function fresh(entry: CacheEntry | undefined | null): CacheEntry | null {
  if (!entry?.updatedAt) return null;
  return Date.now() - entry.updatedAt < TTL_MS ? entry : null;
}

export const trackKey = (track: Pick<MixTrack, "id">) => `sp:${track.id}`;
export const refKey = (artist: string, title: string) => `ref:${artist.trim().toLowerCase()}::${title.trim().toLowerCase()}`;
export const tagKey = (tag: string) => `tag:${tag.trim().toLowerCase()}`;

/** Memory-first lookup with a single Convex round trip for the misses. */
export async function getCache(keys: string[]): Promise<Map<string, CacheEntry>> {
  const found = new Map<string, CacheEntry>();
  const missing: string[] = [];
  for (const key of keys) {
    const hit = fresh(memory.get(key));
    if (hit) found.set(key, hit);
    else missing.push(key);
  }
  if (missing.length) {
    const client = convex();
    if (client) {
      const results = await Promise.allSettled(chunk(missing, 100).map((keys) => client.query(getRef, { keys })));
      for (const result of results) {
        if (result.status === "fulfilled") {
          for (const row of result.value) {
            const hit = fresh(row);
            if (hit) {
              memory.set(row.key, hit);
              found.set(row.key, hit);
            }
          }
        } else {
          console.warn("Enrichment cache read failed:", result.reason instanceof Error ? result.reason.message : result.reason);
        }
      }
    }
  }
  return found;
}

/** Stamps and stores entries in memory, then best-effort persists to Convex. */
export async function putCache(entries: CacheEntry[]): Promise<void> {
  if (!entries.length) return;
  const stamped = entries.map((entry) => ({ ...entry, updatedAt: entry.updatedAt || Date.now() }));
  for (const entry of stamped) memory.set(entry.key, entry);
  const client = convex();
  if (client) {
    const results = await Promise.allSettled(chunk(stamped, 50).map((group) => client.mutation(putRef, { entries: group })));
    for (const result of results) {
      if (result.status === "rejected") console.warn("Enrichment cache write failed:", result.reason instanceof Error ? result.reason.message : result.reason);
    }
  }
}

/** Test hook: drop the process-local layer. */
export function clearMemoryCacheForTests() {
  memory.clear();
}
