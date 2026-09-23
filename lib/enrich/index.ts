// Enrichment orchestrator.
//
// After retrieval and before Jev judging, candidates receive deterministic
// evidence within the generation budget:
//
//   Tier 1  Reccobeats  batched audio analysis + ISRC        (~1.5/s, no key)
//   Tier 2  Last.fm     community tags with counts + summary (~4/s, API key)
//                        identity = Spotify's own track/artist name strings
//   Tier 3  MusicBrainz ISRC->mbid identity + curated genres (~0.9/s, hard cap)
//   Tier 2b Last.fm retry by mbid when the string identity missed
//                        (MusicBrainz is the Last.fm identity fallback)
//
// Design rules:
//   - References, anchors, and familiar tracks are enriched first.
//   - Slow MusicBrainz lookups and uncached Last.fm work have bounded budgets.
//   - Fail-open per track and per tier: a dead provider skips its tier.
//   - Field-presence targeting: a tier only runs for tracks still missing
//     what that tier provides, so a partial cache entry self-heals next run.
//   - Convex cache makes successful lookups reusable across mixes.
//
// It also produces the two plan-level enrichment facts:
//   - reference similarity evidence (track.getSimilar on plan references),
//     used both as candidate judging evidence and as retrieval queries;
//   - tag definitions (tag.getInfo) for the plan's genres/avoidTraits.

import type { MixPlan, MixTrack, TrackSimilarity } from "@/lib/types";
import { dedupeBy, mapConcurrent } from "@/lib/utils";
import { matchesArtistConstraints } from "@/lib/artist-constraints";
import { albumKey } from "@/lib/prompt-plan";
import { fetchCatalogTracks, fillSpotifyAudioFeatures, resolveSpotifyIdentity } from "@/lib/spotify";
import { getCache, putCache, refKey, tagKey, trackKey, type CacheEntry, type CacheTried } from "./cache";
import * as lastfm from "./lastfm";
import * as musicbrainz from "./musicbrainz";
import * as reccobeats from "./reccobeats";
import { normalizeTags } from "./tags";

export type ReferenceEvidence = {
  /** `${title}::${artist}` (lowercase) -> similarities to the plan's references. */
  byTrackKey: Map<string, TrackSimilarity[]>;
  /** Flattened, match-ordered similar tracks for query generation. */
  similarTracks: { title: string; artist: string; match: number; ref: string }[];
};

export type EnrichOutcome = {
  candidates: MixTrack[];
  tagDefinitions: Record<string, string>;
  stats: { features: number; tagged: number; mbidResolved: number; withSimilar: number; definitions: number };
};

export type EnrichOptions = { maxNewTracks?: number; lastfmLimit?: number; musicbrainzLimit?: number; deadlineAt?: number; tagDefinitions?: Record<string, string>; spotifyAccessToken?: string };

export const emptyEvidence = (): ReferenceEvidence => ({ byTrackKey: new Map(), similarTracks: [] });

const candidateKey = (track: Pick<MixTrack, "name" | "artists">) => `${track.name}::${track.artists[0] ?? ""}`.toLowerCase();

function enrichLimit(): number {
  const raw = Number(process.env.ENRICH_MAX_TRACKS || 0);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : Number.POSITIVE_INFINITY;
}

// References first, then artist-scoped tracks, then familiar ones — the tracks
// most likely to be picked (and most expensive to get wrong) go first.
function byPriority(candidates: MixTrack[], plan: MixPlan): MixTrack[] {
  const refKeys = new Set(plan.referenceTracks.map((ref) => `${ref.name}::${ref.artist}`.toLowerCase()));
  const artists = new Set([...plan.anchorArtists, ...plan.allowedArtists].map((name) => name.toLowerCase()));
  return candidates
    .map((track, index) => {
      let score = index;
      if (refKeys.has(candidateKey(track))) score -= 100_000;
      else if ((plan.preferredAlbums ?? []).some((album) => albumKey(album) === albumKey(track.album))) score -= 50_000;
      else if (track.artists.some((artist) => artists.has(artist.toLowerCase()))) score -= 10_000;
      else if (track.familiar) score -= 1_000;
      return { track, score };
    })
    .sort((a, b) => a.score - b.score)
    .map((entry) => entry.track);
}

/**
 * Similar-track evidence for the plan's reference recordings. Cached per
 * reference; the live path resolves Spotify-canonical artist/title strings
 * first (Spotify search) so the Last.fm lookup uses the catalog's own names,
 * and only falls back to a MusicBrainz mbid — then the planner's raw strings
 * with autocorrect — when Spotify cannot confirm an identity.
 */
export async function gatherReferenceEvidence(plan: MixPlan, accessToken?: string, deadlineAt?: number): Promise<ReferenceEvidence> {
  const evidence = emptyEvidence();
  const refs = plan.referenceTracks.slice(0, 8);
  if (!refs.length || !lastfm.hasLastfm()) return evidence;

  const keys = refs.map((ref) => refKey(ref.artist, ref.name));
  const cached = await getCache(keys);
  const dirty: CacheEntry[] = [];

  await Promise.all(refs.map(async (ref) => {
    const key = refKey(ref.artist, ref.name);
    const label = `${ref.artist} — ${ref.name}`;
    let similar = cached.get(key)?.similar;
    let mbid = cached.get(key)?.mbid;
    if (!similar) {
      try {
        // Spotify's catalog strings are the primary Last.fm identity;
        // MusicBrainz only resolves an mbid when Spotify cannot.
        const spotify = accessToken ? await resolveSpotifyIdentity(accessToken, ref.name, ref.artist) : null;
        let identity: lastfm.TrackRef;
        if (spotify) {
          identity = { track: spotify.track, artist: spotify.artist };
        } else {
          mbid = mbid ?? (deadlineAt && Date.now() > deadlineAt - 70_000
            ? undefined : (await musicbrainz.searchRecording(ref.name, ref.artist)) ?? undefined);
          identity = mbid ? { mbid } : { track: ref.name, artist: ref.artist };
        }
        const found = await lastfm.trackSimilar(identity, 50);
        similar = found.map(({ title, artist, match }) => ({ title, artist, match }));
        dirty.push({ key, mbid, similar, updatedAt: Date.now() });
      } catch (error) {
        console.warn("Reference similarity lookup failed:", error instanceof Error ? error.message : error);
        similar = [];
      }
    }
    for (const entry of similar ?? []) {
      const trackKeyOfSimilar = `${entry.title}::${entry.artist}`.toLowerCase();
      const list = evidence.byTrackKey.get(trackKeyOfSimilar) ?? [];
      list.push({ ref: label, match: entry.match });
      evidence.byTrackKey.set(trackKeyOfSimilar, list);
      evidence.similarTracks.push({ ...entry, ref: label });
    }
  }));
  evidence.similarTracks.sort((a, b) => b.match - a.match);
  await putCache(dirty);
  return evidence;
}

/** Adds artist-qualified `track:"..." artist:"..."` queries from reference similarity (capped at 8 total). */
export function attachReferenceQueries(plan: MixPlan, evidence: ReferenceEvidence): void {
  if (plan.allowedArtists.length) return;
  const strong = evidence.similarTracks.filter((entry) => entry.match >= 0.55).slice(0, 6);
  if (!strong.length) return;
  const derived = dedupeBy(
    strong.map((entry) => `track:"${entry.title.replace(/"/g, "")}" artist:"${entry.artist.replace(/"/g, "")}"`),
    (query) => query,
  ).slice(0, 4);
  plan.searchQueries = dedupeBy([...plan.searchQueries.slice(0, 6), ...derived], (query) => query).slice(0, 8);
}

/** Definitions for the plan's genres and avoidTraits so Jev interprets terms consistently. */
export async function gatherTagDefinitions(plan: MixPlan): Promise<Record<string, string>> {
  const definitions: Record<string, string> = {};
  if (!lastfm.hasLastfm()) return definitions;
  const terms = dedupeBy([...plan.genres, ...plan.avoidTraits], (term) => term.trim().toLowerCase()).slice(0, 14);
  if (!terms.length) return definitions;

  const cached = await getCache(terms.map(tagKey));
  const dirty: CacheEntry[] = [];
  for (const term of terms) {
    const key = tagKey(term);
    const known = cached.get(key)?.summary;
    if (known) {
      definitions[term] = known;
      continue;
    }
    try {
      const summary = await lastfm.tagInfo(term);
      if (summary) {
        definitions[term] = summary;
        dirty.push({ key, summary, updatedAt: Date.now() });
      } else {
        dirty.push({ key, updatedAt: Date.now() }); // remember the miss
      }
    } catch (error) {
      console.warn("Tag definition lookup failed:", error instanceof Error ? error.message : error);
    }
  }
  await putCache(dirty.filter((entry) => entry.summary));
  return definitions;
}

/**
 * Main entry point: enriches candidates in place on a copied array and
 * returns plan-level tag definitions for the Jev state.
 */
export async function enrichCandidates(
  input: MixTrack[],
  plan: MixPlan,
  evidence: ReferenceEvidence = emptyEvidence(),
  options: EnrichOptions = {},
): Promise<EnrichOutcome> {
  const startedAt = Date.now();
  const candidates = [...input];
  if (!candidates.length) return { candidates, tagDefinitions: {}, stats: { features: 0, tagged: 0, mbidResolved: 0, withSimilar: 0, definitions: 0 } };
  const definitionsPromise = options.tagDefinitions ? Promise.resolve(options.tagDefinitions)
    : options.deadlineAt && Date.now() > options.deadlineAt - 35_000 ? Promise.resolve({})
    : gatherTagDefinitions(plan);

  // 1. Apply whatever the durable cache already knows.
  const cached = await getCache(candidates.map(trackKey));
  const dirty = new Map<string, CacheEntry>();
  const tried = new Map<string, CacheTried>();
  const pending: MixTrack[] = [];
  for (const track of candidates) {
    const entry = cached.get(trackKey(track));
    if (entry) {
      if (entry.tried) tried.set(trackKey(track), { ...entry.tried });
      track.isrc = track.isrc ?? entry.isrc;
      track.mbid = track.mbid ?? entry.mbid;
      track.genres = track.genres?.length ? track.genres : entry.genres;
      track.tags = track.tags?.length ? track.tags : entry.tags;
      track.tagSummary = track.tagSummary ?? entry.summary;
      if (entry.features) {
        for (const [field, value] of Object.entries(entry.features)) {
          const key = field as keyof MixTrack;
          if (track[key] == null && typeof value === "number") (track as Record<string, unknown>)[key] = value;
        }
      }
      if (entry.isrc || entry.mbid || entry.genres || entry.tags || entry.summary || entry.features) {
        track.enriched = { ...track.enriched, reccobeats: Boolean(entry.features), lastfm: Boolean(entry.tags || entry.summary), musicbrainz: Boolean(entry.mbid) };
      }
    }
    pending.push(track);
  }

  const ordered = byPriority(pending, plan).slice(0, Math.min(options.maxNewTracks ?? Number.POSITIVE_INFINITY, enrichLimit()));
  const note = (track: MixTrack, layer: Omit<CacheEntry, "key" | "updatedAt">) => {
    const key = trackKey(track);
    // Seed from the cached entry (not an empty object) so a partial write
    // never drops fields the durable cache already holds: entries are fully
    // replaced on persist, so mbid/isrc/features must ride along every note.
    const base = dirty.get(key) ?? { ...(cached.get(key) ?? { key, updatedAt: Date.now() }), key };
    dirty.set(key, { ...base, ...layer, key, updatedAt: Date.now() });
  };
  const markTried = (track: MixTrack, provider: keyof CacheTried) => {
    const key = trackKey(track);
    const state: CacheTried = { ...(tried.get(key) ?? {}), [provider]: true };
    tried.set(key, state);
    note(track, { tried: state });
  };

  // Shared Tier 2/2b apply. Both passes share everything but the identity:
  // Spotify-canonical strings first, an mbid only as the fallback retry. A
  // genuine miss is negative-cached per identity; outages throw nothing and
  // are retried on the next run (see the catch below).
  const runLastfmTier = async (track: MixTrack, identity: lastfm.TrackRef, missMarker: "lastfm" | "lastfmMbid") => {
    if (options.deadlineAt && Date.now() > options.deadlineAt - 20_000) return;
    try {
      // getInfo already includes the community tags. Ask getTopTags only when
      // getInfo has no useful tags, avoiding two paced requests per recording.
      const info = await lastfm.trackInfo(identity);
      const source = info?.tags?.length ? info.tags : await lastfm.trackTopTags(identity);
      const summary = info?.summary;
      if (!source.length && !summary) {
        markTried(track, missMarker);
        return;
      }
      const normalized = normalizeTags(source);
      track.tags = normalized.tags;
      track.genres = dedupeBy([...normalized.genres, ...(track.genres ?? [])], (genre) => genre).slice(0, 6);
      track.tagSummary = summary;
      track.enriched = { ...track.enriched, lastfm: true };
      note(track, { genres: track.genres, tags: track.tags, summary: track.tagSummary });
    } catch (error) {
      // Exceptions (rate limit, outage) are retried next run; only genuine
      // "provider has nothing" results are negative-cached above.
      console.warn("Last.fm enrichment skipped:", track.name, error instanceof Error ? error.message : error);
    }
  };

  // 2. Tier 1 — Reccobeats audio features + ISRC for anything still missing valence.
  const featureTargets = ordered.filter((track) => track.valence == null);
  if (featureTargets.length && (!options.deadlineAt || Date.now() < options.deadlineAt - 35_000)) {
    try {
      const features = await reccobeats.batchAudioFeatures(featureTargets.map((track) => track.id));
      for (const track of featureTargets) {
        const found = features.get(track.id);
        if (!found) continue;
        const fields = ["energy", "danceability", "tempo", "valence", "acousticness", "instrumentalness", "speechiness", "liveness", "loudness"] as const;
        let applied = false;
        for (const field of fields) {
          const value = found[field];
          if (track[field] == null && typeof value === "number") {
            (track as Record<string, unknown>)[field] = field === "tempo" || field === "loudness" ? Math.round(value * 100) / 100 : Math.round(value * 1000) / 1000;
            applied = true;
          }
        }
        if (found.isrc && !track.isrc) {
          track.isrc = found.isrc;
          applied = true;
        }
        if (applied) {
          track.enriched = { ...track.enriched, reccobeats: true };
          note(track, {
            isrc: track.isrc,
            features: pickFeatures(track),
          });
        }
      }
    } catch (error) {
      console.warn("Reccobeats enrichment skipped:", error instanceof Error ? error.message : error);
    }
  }

  const withoutAudio = ordered.filter((track) => track.energy == null || track.danceability == null);
  if (options.spotifyAccessToken && withoutAudio.length > ordered.length * 0.4
    && (!options.deadlineAt || Date.now() < options.deadlineAt - 30_000)) {
    await fillSpotifyAudioFeatures(options.spotifyAccessToken, withoutAudio);
  }

  // 3. Tier 2 — Last.fm tags + vibe summary for tracks with neither, queried
  // by the Spotify-canonical track/artist strings this candidate already
  // carries (never by mbid: that is Tier 2b's fallback identity).
  const lastfmBudget = options.deadlineAt
    ? Math.max(0, Math.floor((options.deadlineAt - Date.now() - 20_000) / 300))
    : Number.POSITIVE_INFINITY;
  const lastfmTargets = ordered.filter((track) => !track.tags?.length && !track.tagSummary && !tried.get(trackKey(track))?.lastfm)
    .slice(0, Math.min(lastfmBudget, options.lastfmLimit ?? Number.POSITIVE_INFINITY));
  const lastfmStartedAt = Date.now();
  if (lastfmTargets.length && lastfm.hasLastfm()) {
    await mapConcurrent(lastfmTargets, 8, (track) =>
      runLastfmTier(track, { track: track.name, artist: track.artists[0] }, "lastfm"),
    );
  }
  const lastfmMs = Date.now() - lastfmStartedAt;

  // 4. Tier 3 — MusicBrainz identity + curated genres for tracks without an
  // mbid. The mbid doubles as the Last.fm identity fallback for Tier 2b.
  // MusicBrainz is paced below one request per second. Use it where community
  // evidence did not establish a genre, and cap live identity resolution.
  const targetedMusicbrainz = options.musicbrainzLimit !== undefined || options.deadlineAt !== undefined;
  const mbTargets = ordered.filter((track) => !track.mbid && (!targetedMusicbrainz || !track.genres?.length) && !tried.get(trackKey(track))?.musicbrainz)
    .slice(0, options.musicbrainzLimit ?? Number.POSITIVE_INFINITY);
  const musicbrainzStartedAt = Date.now();
  if (mbTargets.length) {
    for (const track of mbTargets) {
      if (options.deadlineAt && Date.now() > options.deadlineAt - 55_000) break;
      try {
        const mbid = (track.isrc ? await musicbrainz.lookupIsrc(track.isrc) : null)
          ?? await musicbrainz.searchRecording(track.name, track.artists[0]);
        if (!mbid) {
          markTried(track, "musicbrainz");
          continue;
        }
        const recording = await musicbrainz.recordingTags(mbid);
        const curated = normalizeTags(recording.genres, { trusted: true });
        const freeform = normalizeTags(recording.tags);
        if (curated.genres.length || freeform.genres.length || freeform.tags.length || recording.genres.length || recording.tags.length) {
          track.genres = dedupeBy([...curated.genres, ...freeform.genres, ...(track.genres ?? [])], (genre) => genre).slice(0, 6);
          track.tags = dedupeBy([...(track.tags ?? []), ...freeform.tags], (tag) => tag).slice(0, 6);
        }
        track.mbid = mbid;
        track.enriched = { ...track.enriched, musicbrainz: true };
        // Only persist the mbid once the recording lookup succeeded, so a
        // failed genres fetch is retried on the next run.
        note(track, { mbid, genres: track.genres, tags: track.tags, summary: track.tagSummary, isrc: track.isrc, features: pickFeatures(track) });
      } catch (error) {
        console.warn("MusicBrainz enrichment skipped:", track.name, error instanceof Error ? error.message : error);
      }
    }
  }
  const musicbrainzMs = Date.now() - musicbrainzStartedAt;

  // 5. Tier 2b — MusicBrainz as the Last.fm identity fallback: when the
  // Spotify-string identity missed but Tier 3 (or the cache) produced an
  // mbid, retry Last.fm once by mbid. Negative-cached per identity like
  // every other genuine miss, so a stuck track stops re-billing next run.
  if (lastfm.hasLastfm()) {
    const mbidTargets = ordered.filter((track) =>
      track.mbid && !track.tags?.length && !track.tagSummary && !tried.get(trackKey(track))?.lastfmMbid,
    ).slice(0, Math.min(lastfmBudget, options.lastfmLimit ?? Number.POSITIVE_INFINITY));
    if (mbidTargets.length) {
      await mapConcurrent(mbidTargets, 8, (track) => runLastfmTier(track, { mbid: track.mbid }, "lastfmMbid"));
    }
  }

  // 6. Reference similarity evidence attached per candidate.
  let withSimilar = 0;
  if (evidence.byTrackKey.size) {
    for (const track of candidates) {
      const matches = evidence.byTrackKey.get(candidateKey(track));
      if (!matches?.length) continue;
      track.similarTo = dedupeBy(matches, (entry) => entry.ref)
        .filter((entry) => entry.match >= 0.3)
        .sort((a, b) => b.match - a.match)
        .slice(0, 3)
        // The client normalizes to 0..1; clamp defensively so Jev never sees
        // a raw provider scale (some Last.fm responses report values > 1).
        .map((entry) => ({ ref: entry.ref, match: Math.min(1, Math.round(entry.match * 100) / 100) }));
      if (track.similarTo.length) withSimilar += 1;
    }
  }

  await putCache([...dirty.values()]);
  const tagDefinitions = await definitionsPromise;

  const stats = {
    features: candidates.filter((track) => track.enriched?.reccobeats).length,
    tagged: candidates.filter((track) => track.enriched?.lastfm).length,
    mbidResolved: candidates.filter((track) => track.enriched?.musicbrainz).length,
    withSimilar,
    definitions: Object.keys(tagDefinitions).length,
  };
  console.info("[mix.enrich]", {
    candidates: candidates.length,
    lastfmTargets: lastfm.hasLastfm() ? lastfmTargets.length : 0,
    musicbrainzTargets: mbTargets.length,
    lastfmMs,
    musicbrainzMs,
    durationMs: Date.now() - startedAt,
    ...stats,
  });
  return { candidates, tagDefinitions, stats };
}

function pickFeatures(track: MixTrack): Record<string, number> | undefined {
  const features: Record<string, number> = {};
  for (const field of ["energy", "danceability", "tempo", "valence", "acousticness", "instrumentalness", "speechiness", "liveness", "loudness"] as const) {
    const value = track[field];
    if (typeof value === "number" && Number.isFinite(value)) features[field] = value;
  }
  return Object.keys(features).length ? features : undefined;
}

/**
 * Discovery expansion: audio-feature recommendations seeded from tracks that
 * already relate to the request (reference matches, then anchor artists).
 * Fail-open — retrieval simply stays keyword-based if ReccoBeats is down.
 */
export async function expandWithRecommendations(candidates: MixTrack[], plan: MixPlan, accessToken?: string): Promise<MixTrack[]> {
  try {
    const refKeys = new Set(plan.referenceTracks.map((ref) => `${ref.name}::${ref.artist}`.toLowerCase()));
    const anchors = new Set(plan.anchorArtists.map((artist) => artist.toLowerCase()));
    const eligible = candidates.filter((track) => matchesArtistConstraints(track, plan));
    const seeds = [
      ...eligible.filter((track) => refKeys.has(candidateKey(track))),
      ...eligible.filter((track) => track.artists.some((artist) => anchors.has(artist.toLowerCase()))),
      ...(accessToken ? eligible.slice(0, 8) : []),
    ];
    const ids = dedupeBy(seeds.map((track) => track.id), (id) => id).slice(0, 5);
    if (!ids.length) return candidates;

    const knownIds = new Set(candidates.map((track) => track.id));
    const knownNames = new Set(candidates.map(candidateKey));
    const fresh: MixTrack[] = (await reccobeats.recommend(ids, Math.min(60, Math.max(40, plan.targetCount))))
      .filter((track) => !knownIds.has(track.spotifyId) && !knownNames.has(`${track.title}::${track.artists[0]}`.toLowerCase()))
      .filter((track) => matchesArtistConstraints({ id: track.spotifyId, name: track.title, artists: track.artists, album: "", durationMs: track.durationMs, source: "search", familiar: false }, plan))
      .map((track) => ({
        id: track.spotifyId,
        uri: `spotify:track:${track.spotifyId}`,
        name: track.title,
        artists: track.artists,
        album: "",
        durationMs: track.durationMs,
        isrc: track.isrc,
        source: "search" as const,
        familiar: false,
      }));
    if (!fresh.length) return candidates;
    // Confirm Spotify playability and retain canonical metadata before a
    // recommendation reaches the judge or the resulting playlist.
    if (accessToken) {
      const catalog = await fetchCatalogTracks(accessToken, fresh.map((track) => track.id));
      return dedupeBy([...candidates, ...fresh.flatMap((track) => {
        const verified = catalog.get(track.id);
        return verified ? [{ ...verified, isrc: track.isrc }] : [];
      })], candidateKey);
    }
    return dedupeBy([...candidates, ...fresh], candidateKey);
  } catch (error) {
    console.warn("Reccobeats recommendations skipped:", error instanceof Error ? error.message : error);
    return candidates;
  }
}
