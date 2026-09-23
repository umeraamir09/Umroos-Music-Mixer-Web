import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fallbackPlan } from "@/lib/prompt-plan";
import type { MixPlan, MixTrack } from "@/lib/types";
import { attachReferenceQueries, enrichCandidates, expandWithRecommendations, gatherReferenceEvidence } from "./index";
import * as cache from "./cache";
import * as lastfm from "./lastfm";
import * as musicbrainz from "./musicbrainz";
import * as reccobeats from "./reccobeats";
import * as spotify from "@/lib/spotify";

vi.mock("./cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cache")>();
  return { ...actual, getCache: vi.fn(), putCache: vi.fn() };
});
vi.mock("@/lib/spotify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/spotify")>();
  return { ...actual, resolveSpotifyIdentity: vi.fn(), fetchTrackNames: vi.fn(), fetchCatalogTracks: vi.fn() };
});
vi.mock("./lastfm", () => ({
  hasLastfm: vi.fn(),
  trackTopTags: vi.fn(),
  trackInfo: vi.fn(),
  trackSimilar: vi.fn(),
  tagInfo: vi.fn(),
  stripHtml: vi.fn(),
}));
vi.mock("./musicbrainz", () => ({
  lookupIsrc: vi.fn(),
  searchRecording: vi.fn(),
  recordingTags: vi.fn(),
}));
vi.mock("./reccobeats", () => ({
  batchAudioFeatures: vi.fn(),
  recommend: vi.fn(),
  searchTracks: vi.fn(),
}));

const makeTrack = (over: Partial<MixTrack> & { id: string }): MixTrack => ({
  name: over.id,
  artists: ["Drake"],
  album: "Album",
  durationMs: 180_000,
  source: "search",
  familiar: false,
  ...over,
});

const planFor = (over: Partial<MixPlan> = {}): MixPlan => ({
  ...fallbackPlan("A soft indie mix like yel's song GHOST"),
  genres: ["indie"],
  avoidTraits: [],
  anchorArtists: ["Yel"],
  allowedArtists: [],
  referenceTracks: [{ name: "GHOST", artist: "Yel" }],
  ...over,
});

beforeEach(() => {
  vi.stubEnv("LASTFM_API_KEY", "test-key");
  vi.mocked(cache.getCache).mockResolvedValue(new Map());
  vi.mocked(cache.putCache).mockResolvedValue(undefined);
  vi.mocked(lastfm.hasLastfm).mockReturnValue(true);
  vi.mocked(lastfm.trackTopTags).mockResolvedValue([]);
  vi.mocked(lastfm.trackInfo).mockResolvedValue(null);
  vi.mocked(lastfm.trackSimilar).mockResolvedValue([]);
  vi.mocked(lastfm.tagInfo).mockResolvedValue(null);
  vi.mocked(musicbrainz.lookupIsrc).mockResolvedValue(null);
  vi.mocked(musicbrainz.searchRecording).mockResolvedValue(null);
  vi.mocked(musicbrainz.recordingTags).mockResolvedValue({ genres: [], tags: [] });
  vi.mocked(reccobeats.batchAudioFeatures).mockResolvedValue(new Map());
  vi.mocked(reccobeats.recommend).mockResolvedValue([]);
  vi.mocked(reccobeats.searchTracks).mockResolvedValue([]);
  vi.mocked(spotify.resolveSpotifyIdentity).mockResolvedValue(null);
  vi.mocked(spotify.fetchTrackNames).mockResolvedValue(new Map());
  vi.mocked(spotify.fetchCatalogTracks).mockResolvedValue(new Map());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("reference evidence", () => {
  it("resolves references through Spotify search before asking Last.fm for similar tracks", async () => {
    vi.mocked(spotify.resolveSpotifyIdentity).mockResolvedValue({ track: "GHOST", artist: "Yel" });
    vi.mocked(lastfm.trackSimilar).mockResolvedValue([
      { title: "Space Song", artist: "Beach House", match: 0.9 },
      { title: "Myth", artist: "Beach House", match: 0.8 },
      { title: "Weak", artist: "Someone", match: 0.2 },
    ]);

    const evidence = await gatherReferenceEvidence(planFor(), "spotify-token");

    expect(spotify.resolveSpotifyIdentity).toHaveBeenCalledWith("spotify-token", "GHOST", "Yel");
    expect(lastfm.trackSimilar).toHaveBeenCalledWith({ track: "GHOST", artist: "Yel" }, 50);
    // Spotify confirmed the identity, so MusicBrainz is never consulted.
    expect(musicbrainz.searchRecording).not.toHaveBeenCalled();
    expect(evidence.byTrackKey.get("space song::beach house")).toEqual([{ ref: "Yel — GHOST", match: 0.9 }]);
    expect(evidence.similarTracks).toHaveLength(3);
    const refWrites = vi.mocked(cache.putCache).mock.calls[0][0];
    expect(refWrites[0]).toMatchObject({ key: "ref:yel::ghost" });
    expect(refWrites[0].mbid).toBeUndefined();
  });

  it("falls back to MusicBrainz's mbid identity when Spotify cannot resolve the reference", async () => {
    vi.mocked(spotify.resolveSpotifyIdentity).mockResolvedValue(null);
    vi.mocked(musicbrainz.searchRecording).mockResolvedValue("ref-mbid");
    vi.mocked(lastfm.trackSimilar).mockResolvedValue([{ title: "GHOST", artist: "Yel", match: 1 }]);

    await gatherReferenceEvidence(planFor(), "spotify-token");

    expect(musicbrainz.searchRecording).toHaveBeenCalledWith("GHOST", "Yel");
    expect(lastfm.trackSimilar).toHaveBeenCalledWith({ mbid: "ref-mbid" }, 50);
    const refWrites = vi.mocked(cache.putCache).mock.calls[0][0];
    expect(refWrites[0]).toMatchObject({ key: "ref:yel::ghost", mbid: "ref-mbid" });
  });

  it("derives artist-qualified retrieval queries above the strength threshold", async () => {
    vi.mocked(lastfm.trackSimilar).mockResolvedValue([
      { title: "Space Song", artist: "Beach House", match: 0.9 },
      { title: "Myth", artist: "Beach House", match: 0.8 },
      { title: "Weak", artist: "Someone", match: 0.2 },
    ]);
    const plan = planFor();

    attachReferenceQueries(plan, await gatherReferenceEvidence(plan));

    expect(plan.searchQueries).toContain('track:"Space Song" artist:"Beach House"');
    expect(plan.searchQueries).not.toContain('track:"Weak" artist:"Someone"');
    expect(plan.searchQueries.length).toBeLessThanOrEqual(8);
  });

  it("skips reference evidence entirely without a Last.fm key", async () => {
    vi.stubEnv("LASTFM_API_KEY", "");
    vi.mocked(lastfm.hasLastfm).mockReturnValue(false);

    const evidence = await gatherReferenceEvidence(planFor(), "spotify-token");

    expect(evidence.byTrackKey.size).toBe(0);
    expect(spotify.resolveSpotifyIdentity).not.toHaveBeenCalled();
    expect(lastfm.trackSimilar).not.toHaveBeenCalled();
    expect(musicbrainz.searchRecording).not.toHaveBeenCalled();
  });

  it("falls back to name+autocorrect when Spotify and MusicBrainz both miss", async () => {
    vi.mocked(spotify.resolveSpotifyIdentity).mockResolvedValue(null);
    vi.mocked(musicbrainz.searchRecording).mockResolvedValue(null);
    vi.mocked(lastfm.trackSimilar).mockResolvedValue([{ title: "GHOST", artist: "Yel", match: 1 }]);

    await gatherReferenceEvidence(planFor(), "spotify-token");

    expect(lastfm.trackSimilar).toHaveBeenCalledWith({ track: "GHOST", artist: "Yel" }, 50);
  });
});

describe("candidate enrichment", () => {
  it("enriches candidates across all three tiers and reports stats", async () => {
    vi.mocked(reccobeats.batchAudioFeatures).mockResolvedValue(new Map([["id1", {
      spotifyId: "id1",
      isrc: "US-TOXY-10-0016",
      energy: 0.78,
      danceability: 0.7,
      tempo: 121.5,
      valence: 0.61,
      acousticness: 0.12,
      instrumentalness: 0.001,
      speechiness: 0.04,
      liveness: 0.11,
      loudness: -5.4,
    }]]));
    vi.mocked(lastfm.trackTopTags).mockResolvedValue([
      { name: "house", count: 90 },
      { name: "club", count: 55 },
      { name: "seen live", count: 300 }, // junk, must not survive
    ]);
    vi.mocked(lastfm.trackInfo).mockResolvedValue({ tags: [], summary: "A propulsive club track." });
    vi.mocked(lastfm.trackSimilar).mockResolvedValue([{ title: "Massive", artist: "Drake", match: 9 }]);
    vi.mocked(lastfm.tagInfo).mockResolvedValue("Community definition.");
    vi.mocked(musicbrainz.searchRecording).mockResolvedValue("ref-mbid");
    vi.mocked(musicbrainz.lookupIsrc).mockResolvedValue("mbid-1");
    vi.mocked(musicbrainz.recordingTags).mockResolvedValue({
      genres: [{ name: "house", count: 10 }],
      tags: [{ name: "groovy", count: 7 }, { name: "90s", count: 40 }],
    });

    const plan = planFor({ avoidTraits: ["harsh"] });
    const evidence = await gatherReferenceEvidence(plan);
    const outcome = await enrichCandidates([makeTrack({ id: "id1", name: "Massive" })], plan, evidence);
    const enriched = outcome.candidates[0];

    // Tier 1: ReccoBeats audio analysis + ISRC.
    expect(enriched.isrc).toBe("US-TOXY-10-0016");
    expect(enriched.valence).toBeCloseTo(0.61);
    expect(enriched.tempo).toBe(121.5);
    // Tier 2: Last.fm community tags by name (mbid comes later) + summary.
    expect(lastfm.trackTopTags).toHaveBeenCalledWith({ track: "Massive", artist: "Drake" });
    expect(enriched.tagSummary).toBe("A propulsive club track.");
    expect(enriched.tags).toEqual(["house", "club", "groovy", "90s"]); // junk gone, era demoted
    expect(enriched.genres).toEqual(["house"]);
    // Tier 3: MusicBrainz identity via ISRC + curated genres merged first.
    expect(musicbrainz.lookupIsrc).toHaveBeenCalledWith("US-TOXY-10-0016");
    expect(enriched.mbid).toBe("mbid-1");
    // Reference similarity evidence attached to the candidate.
    expect(enriched.similarTo).toEqual([{ ref: "Yel — GHOST", match: 1 }]);
    expect(enriched.enriched).toEqual({ reccobeats: true, lastfm: true, musicbrainz: true });
    // Plan-level tag definitions for Jev.
    expect(outcome.tagDefinitions).toEqual({ indie: "Community definition.", harsh: "Community definition." });
    expect(outcome.stats).toEqual({ features: 1, tagged: 1, mbidResolved: 1, withSimilar: 1, definitions: 2 });
    // The merged track state is persisted for the next run.
    const persisted = vi.mocked(cache.putCache).mock.calls.flat().flatMap((entries) => entries).find((entry) => entry.key === "sp:id1");
    expect(persisted).toMatchObject({ mbid: "mbid-1", isrc: "US-TOXY-10-0016" });
  });

  it("applies cached entries without touching any provider", async () => {
    vi.mocked(cache.getCache).mockImplementation(async (keys: string[]) => {
      const map = new Map<string, cache.CacheEntry>();
      for (const key of keys) {
        if (key !== "sp:id1") continue;
        map.set(key, {
          key,
          isrc: "US-CACHED-1",
          mbid: "mbid-9",
          genres: ["house"],
          tags: ["house", "groovy"],
          summary: "Cached summary.",
          features: { energy: 0.5, danceability: 0.6, tempo: 100, valence: 0.4 },
          updatedAt: Date.now(),
        });
      }
      return map;
    });

    const outcome = await enrichCandidates([makeTrack({ id: "id1", name: "Cached" })], planFor());
    const enriched = outcome.candidates[0];

    expect(enriched.isrc).toBe("US-CACHED-1");
    expect(enriched.mbid).toBe("mbid-9");
    expect(enriched.valence).toBe(0.4);
    expect(enriched.genres).toEqual(["house"]);
    expect(enriched.tagSummary).toBe("Cached summary.");
    expect(reccobeats.batchAudioFeatures).not.toHaveBeenCalled();
    expect(lastfm.trackTopTags).not.toHaveBeenCalled();
    expect(musicbrainz.recordingTags).not.toHaveBeenCalled();
    expect(outcome.stats).toEqual({ features: 1, tagged: 1, mbidResolved: 1, withSimilar: 0, definitions: 0 });
    // Nothing new to write back.
    for (const [entries] of vi.mocked(cache.putCache).mock.calls) expect(entries).toEqual([]);
  });

  it("fails open when a provider is down while the other tiers still run", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(reccobeats.batchAudioFeatures).mockRejectedValue(new Error("ReccoBeats 503"));
    vi.mocked(lastfm.trackTopTags).mockResolvedValue([{ name: "indie", count: 40 }]);
    vi.mocked(lastfm.trackInfo).mockResolvedValue({ tags: [], summary: "Dreamy and slow." });
    vi.mocked(musicbrainz.searchRecording).mockResolvedValue("mbid-x");
    vi.mocked(musicbrainz.recordingTags).mockResolvedValue({ genres: [{ name: "indie", count: 3 }], tags: [] });

    const outcome = await enrichCandidates([makeTrack({ id: "id1", name: "Space Song" })], planFor());
    const enriched = outcome.candidates[0];

    expect(warn).toHaveBeenCalled();
    expect(enriched.tagSummary).toBe("Dreamy and slow.");
    expect(enriched.mbid).toBe("mbid-x");
    expect(enriched.genres).toContain("indie");
    expect(enriched.valence).toBeUndefined();
    expect(outcome.stats.features).toBe(0);
  });

  it("negative-caches genuine misses so obscure tracks do not re-bill the 1/s queue", async () => {
    const track = () => makeTrack({ id: "id1", name: "Obscure Song" });
    vi.mocked(lastfm.trackInfo).mockResolvedValue(null);
    vi.mocked(musicbrainz.searchRecording).mockResolvedValue(null);

    await enrichCandidates([track()], planFor());

    expect(lastfm.trackTopTags).toHaveBeenCalledTimes(1);
    expect(musicbrainz.searchRecording).toHaveBeenCalledTimes(1);
    const entry = vi.mocked(cache.putCache).mock.calls.flat().flatMap((entries) => entries).find((item) => item.key === "sp:id1");
    expect(entry?.tried).toEqual({ lastfm: true, musicbrainz: true });

    // Next run loads the entry: both tiers stay skipped.
    vi.mocked(cache.getCache).mockResolvedValue(new Map<string, cache.CacheEntry>([[entry!.key, entry!]]));
    await enrichCandidates([track()], planFor());

    expect(lastfm.trackTopTags).toHaveBeenCalledTimes(1);
    expect(musicbrainz.searchRecording).toHaveBeenCalledTimes(1);
    // ReccoBeats is deliberately retried every run: its database keeps growing.
    expect(reccobeats.batchAudioFeatures).toHaveBeenCalledTimes(2);
  });

  it("queries Last.fm by Spotify-canonical name first and retries by mbid only after a miss", async () => {
    // The string identity has nothing for this track; the mbid identity does.
    vi.mocked(lastfm.trackTopTags).mockImplementation(async (ref) => (ref.mbid ? [{ name: "house", count: 40 }] : []));
    vi.mocked(lastfm.trackInfo).mockImplementation(async (ref) => (ref.mbid ? { tags: [], summary: "Resolved by mbid." } : null));
    vi.mocked(musicbrainz.searchRecording).mockResolvedValue("mbid-2");

    const outcome = await enrichCandidates([makeTrack({ id: "id1", name: "Obscure" })], planFor());
    const enriched = outcome.candidates[0];

    // Tier 2: Spotify's strings for this candidate, never the mbid.
    expect(lastfm.trackTopTags).toHaveBeenCalledWith({ track: "Obscure", artist: "Drake" });
    expect(lastfm.trackInfo).toHaveBeenCalledWith({ track: "Obscure", artist: "Drake" });
    // Tier 3 resolved an identity, so Tier 2b retries with it.
    expect(lastfm.trackTopTags).toHaveBeenCalledWith({ mbid: "mbid-2" });
    expect(enriched.tagSummary).toBe("Resolved by mbid.");
    expect(enriched.tags).toEqual(["house"]);
    expect(enriched.mbid).toBe("mbid-2");
    expect(enriched.enriched).toMatchObject({ lastfm: true, musicbrainz: true });
    expect(outcome.stats).toMatchObject({ tagged: 1, mbidResolved: 1 });
  });

  it("negative-caches the mbid retry so a stuck track stops re-billing", async () => {
    vi.mocked(musicbrainz.searchRecording).mockResolvedValue("mbid-3");
    vi.mocked(musicbrainz.recordingTags).mockResolvedValue({ genres: [{ name: "indie", count: 5 }], tags: [] });

    await enrichCandidates([makeTrack({ id: "id1", name: "Obscure" })], planFor());

    // One string pass + one mbid pass, both misses.
    expect(lastfm.trackTopTags).toHaveBeenCalledTimes(2);
    const entry = vi.mocked(cache.putCache).mock.calls.flat().flatMap((entries) => entries).find((item) => item.key === "sp:id1");
    expect(entry?.tried).toEqual({ lastfm: true, lastfmMbid: true });
    // The write is seeded from the cache, so Tier 3's identity rides along.
    expect(entry?.mbid).toBe("mbid-3");

    // Next run loads the entry: both identity passes stay skipped.
    vi.mocked(cache.getCache).mockResolvedValue(new Map([[entry!.key, entry!]]));
    await enrichCandidates([makeTrack({ id: "id1", name: "Obscure" })], planFor());

    expect(lastfm.trackTopTags).toHaveBeenCalledTimes(2);
    expect(lastfm.trackInfo).toHaveBeenCalledTimes(2);
  });

  it("lets priority order decide who gets enriched when ENRICH_MAX_TRACKS caps the queue", async () => {
    vi.stubEnv("ENRICH_MAX_TRACKS", "1");
    const referenceMatch = makeTrack({ id: "ref-match", name: "GHOST", artists: ["Yel"] });
    const other = makeTrack({ id: "other", name: "Unrelated" });

    await enrichCandidates([other, referenceMatch], planFor());

    expect(reccobeats.batchAudioFeatures).toHaveBeenCalledWith(["ref-match"]);
  });

  it("handles an empty pool without any provider traffic", async () => {
    const outcome = await enrichCandidates([], planFor());
    expect(outcome.candidates).toEqual([]);
    expect(reccobeats.batchAudioFeatures).not.toHaveBeenCalled();
    expect(lastfm.trackTopTags).not.toHaveBeenCalled();
  });
});

describe("recommendation expansion", () => {
  it("seeds recommendations from reference matches and honors artist constraints", async () => {
    const plan = planFor({ avoidArtists: ["SZA"] });
    const seed = makeTrack({ id: "seed-id", name: "GHOST", artists: ["Yel"] });
    vi.mocked(reccobeats.recommend).mockResolvedValue([
      { spotifyId: "new-id", title: "New Track", artists: ["Drake"], durationMs: 1000, isrc: "US-NEW-1" },
      { spotifyId: "seed-id", title: "GHOST", artists: ["Yel"], durationMs: 1000 }, // duplicate
      { spotifyId: "foreign-id", title: "Foreign", artists: ["SZA"], durationMs: 1000 }, // excluded artist
    ]);

    const result = await expandWithRecommendations([seed], plan);

    expect(reccobeats.recommend).toHaveBeenCalledWith(["seed-id"], 40);
    expect(result.map((track) => track.id)).toEqual(["seed-id", "new-id"]);
    expect(result[1]).toMatchObject({ id: "new-id", source: "search", familiar: false });
  });

  it("leaves the pool untouched when no seed can be chosen", async () => {
    const solo = makeTrack({ id: "solo", name: "Solo" });

    const result = await expandWithRecommendations([solo], planFor());

    expect(reccobeats.recommend).not.toHaveBeenCalled();
    expect(result).toEqual([solo]);
  });

  it("canonicalizes ReccoBeats titles through Spotify before they reach Last.fm", async () => {
    const seed = makeTrack({ id: "seed-id", name: "GHOST", artists: ["Yel"] });
    vi.mocked(reccobeats.recommend).mockResolvedValue([
      { spotifyId: "new-id", title: "New Trak", artists: ["Drake"], durationMs: 1000 },
    ]);
    vi.mocked(spotify.fetchCatalogTracks).mockResolvedValue(new Map([["new-id", makeTrack({ id: "new-id", name: "New Track" })]]));

    const result = await expandWithRecommendations([seed], planFor(), "spotify-token");

    expect(spotify.fetchCatalogTracks).toHaveBeenCalledWith("spotify-token", ["new-id"]);
    expect(result.find((track) => track.id === "new-id")).toMatchObject({ name: "New Track", artists: ["Drake"] });
  });

  it("leaves ReccoBeats' own strings when no Spotify token is available", async () => {
    const seed = makeTrack({ id: "seed-id", name: "GHOST", artists: ["Yel"] });
    vi.mocked(reccobeats.recommend).mockResolvedValue([
      { spotifyId: "new-id", title: "New Trak", artists: ["Drake"], durationMs: 1000 },
    ]);

    const result = await expandWithRecommendations([seed], planFor());

    expect(spotify.fetchTrackNames).not.toHaveBeenCalled();
    expect(result.find((track) => track.id === "new-id")?.name).toBe("New Trak");
  });

  it("fails open when recommendations are unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seed = makeTrack({ id: "seed-id", name: "GHOST", artists: ["Yel"] });
    vi.mocked(reccobeats.recommend).mockRejectedValue(new Error("ReccoBeats down"));

    const result = await expandWithRecommendations([seed], planFor());

    expect(warn).toHaveBeenCalled();
    expect(result).toEqual([seed]);
  });
});
