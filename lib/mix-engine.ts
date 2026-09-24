import { createCover } from "@/lib/cover";
import { demoCatalog } from "@/lib/demo-catalog";
import { attachReferenceQueries, enrichCandidates, expandWithRecommendations, gatherReferenceEvidence } from "@/lib/enrich";
import { matchesArtistConstraints } from "@/lib/artist-constraints";
import { createMixPlan } from "@/lib/planner";
import { chooseTracks, scoreCandidates } from "@/lib/selector";
import { getLikedTracksPreview, getLikedTracksSample, getPreferredAlbumCandidates, getSpotifyAppToken, hasSpotifyAppCredentials, markLibraryMembership, searchSpotifyCandidates } from "@/lib/spotify";
import { albumKey } from "@/lib/prompt-plan";
import type { EnrichContext, MixPlan, MixRecord, MixTrack, SpotifySession } from "@/lib/types";
import { dedupeBy, stableId } from "@/lib/utils";

const trackIdentity = (track: MixTrack) => `${track.name}::${track.artists[0]}`.normalize("NFKC").toLowerCase();

function markFamiliar(candidates: MixTrack[], liked: MixTrack[]) {
  const ids = new Set(liked.map((track) => track.id));
  const names = new Set(liked.map(trackIdentity));
  return candidates.map((track) => ({ ...track, familiar: ids.has(track.id) || names.has(trackIdentity(track)) }));
}

function firstPass(candidates: MixTrack[], liked: MixTrack[], plan: MixPlan, prompt: string): MixTrack[] {
  const limit = Math.min(380, Math.max(15, Math.ceil(plan.targetCount * 2.5)));
  const searches = candidates.filter((track) => track.source !== "saved");
  const namedAlbums = new Set((plan.preferredAlbums ?? []).map(albumKey));
  const albumTracks = searches.filter((track) => namedAlbums.has(albumKey(track.album)));
  const familiar = liked.filter((track) => matchesArtistConstraints(track, plan));
  if (/\b(?:only|exclusively)\s+(?:my\s+)?(?:liked|saved)\s+(?:songs|tracks)\b|\b(?:only|exclusively)\s+songs\s+(?:from|in)\s+my\s+library\b/i.test(prompt)) {
    return dedupeBy([...familiar, ...candidates.filter((track) => track.familiar)], trackIdentity).slice(0, limit);
  }
  if (/\b(?:no|exclude|without)\s+(?:my\s+)?(?:liked|saved)\s+(?:songs|tracks)\b/i.test(prompt)) {
    return dedupeBy(searches.filter((track) => !track.familiar), trackIdentity).slice(0, limit);
  }
  // Reserve a share of the judge's first pass for the user's library while
  // preserving catalog query order and every hard artist restriction.
  return dedupeBy([
    ...albumTracks,
    ...searches.slice(0, Math.ceil(limit * 0.75)),
    ...familiar.slice(0, Math.ceil(limit * 0.25)),
    ...candidates,
    ...familiar,
  ], trackIdentity).slice(0, limit);
}

export async function generateMix(prompt: string, session: SpotifySession | null): Promise<MixRecord> {
  const startedAt = Date.now();
  const deadlineAt = Date.now() + 120_000;
  const catalogToken = session?.accessToken || (hasSpotifyAppCredentials() ? await getSpotifyAppToken() : null);
  if (!catalogToken && process.env.NODE_ENV === "production") throw new Error("Spotify catalog credentials are not configured for the public demo.");
  const preview = session ? await getLikedTracksPreview(session.accessToken).catch(() => null) : null;
  const previewTracks = session && preview ? await getLikedTracksSample(session.accessToken, preview, 1) : [];
  const tasteMs = Date.now() - startedAt;
  // Full-library pagination is unbounded. Sample across its history while the
  // planner runs; search still supplies the main request-specific catalog.
  const likedPromise = session && preview
    ? getLikedTracksSample(session.accessToken, preview, 8)
    : Promise.resolve(previewTracks);
  const planningStarted = Date.now();
  // Spotify supplied library data must stay out of every AI prompt.
  const { plan } = await createMixPlan(prompt);
  const planningMs = Date.now() - planningStarted;
  const coverPromise = createCover(plan).catch((error) => {
    console.warn("Cover generation failed:", error instanceof Error ? error.message : error);
    return null;
  });

  let tagDefinitions: EnrichContext["tagDefinitions"];
  let scored: MixTrack[] = [];
  let jevEvaluated = 0;
  let retrievalMs = 0;
  let enrichmentMs = 0;
  let judgingMs = 0;
  let retrievedCandidates = 0;
  let resolvedAlbumTracks = 0;

  if (catalogToken) {
    const initialQueries = [...plan.searchQueries];
    const searchBudget = session
      ? Math.min(400, Math.max(20, plan.targetCount * 3))
      : Math.min(100, Math.max(30, plan.targetCount * 2));
    const [liked, evidence, initialSearch, albumSearch] = await Promise.all([
      likedPromise,
      gatherReferenceEvidence(plan, catalogToken, deadlineAt),
      searchSpotifyCandidates(catalogToken, initialQueries, searchBudget),
      getPreferredAlbumCandidates(catalogToken, plan),
    ]);
    attachReferenceQueries(plan, evidence);
    const additionalQueries = plan.searchQueries.filter((query) => !initialQueries.includes(query));
    const canExpand = Date.now() < deadlineAt - 60_000;
    const [referenceSearch, expanded] = await Promise.all([
      Date.now() < deadlineAt - 40_000 ? searchSpotifyCandidates(catalogToken, additionalQueries, 40) : Promise.resolve([]),
      canExpand && !(plan.preferredAlbums ?? []).length ? expandWithRecommendations(markFamiliar(initialSearch, liked), plan, catalogToken)
        : Promise.resolve(markFamiliar(initialSearch, liked)),
    ]);
    const pool = dedupeBy([
      ...markFamiliar(albumSearch, liked),
      ...markFamiliar(referenceSearch, liked),
      ...expanded,
      ...liked,
    ].filter((track) => matchesArtistConstraints(track, plan)), trackIdentity);
    retrievedCandidates = pool.length;
    resolvedAlbumTracks = albumSearch.length;
    retrievalMs = Date.now() - startedAt - tasteMs - planningMs;

    const initial = firstPass(pool, liked, plan, prompt);
    if (session && Date.now() < deadlineAt - 30_000) await markLibraryMembership(catalogToken, initial);
    const enrichStarted = Date.now();
    const firstOutcome = await enrichCandidates(initial, plan, evidence, {
      maxNewTracks: initial.length,
      lastfmLimit: Math.min(48, Math.ceil(plan.targetCount * 1.2)),
      musicbrainzLimit: 3,
      deadlineAt,
      spotifyAccessToken: catalogToken,
    });
    enrichmentMs += Date.now() - enrichStarted;
    tagDefinitions = firstOutcome.tagDefinitions;
    const judgeStarted = Date.now();
    const firstScores = await scoreCandidates(firstOutcome.candidates, plan, prompt, { tagDefinitions }, { localOnly: true });
    judgingMs += Date.now() - judgeStarted;
    scored = firstScores.tracks;
    jevEvaluated = firstScores.jevEvaluated;

    // If Jev rejects many records, search deeper when request-led candidates
    // are scarce, then judge untried catalog and library tracks.
    for (let pass = 0; pass < 2 && Date.now() < deadlineAt - 18_000; pass += 1) {
      const shortage = plan.targetCount - chooseTracks(scored, plan, prompt).length;
      if (shortage <= 0) break;
      const seen = new Set(scored.map(trackIdentity));
      const remaining = pool.filter((track) => !seen.has(trackIdentity(track)));
      const unjudgedSearch = remaining.filter((track) => track.source !== "saved");
      const broadQueries = plan.searchQueries.filter((query) => !/\btrack\s*:/i.test(query));
      const stride = Math.max(1, Math.ceil(searchBudget / (10 * Math.max(1, broadQueries.length))));
      const moreSearch = unjudgedSearch.length >= shortage * 3 ? [] : await searchSpotifyCandidates(
        catalogToken, plan.searchQueries, Math.max(20, plan.targetCount), stride * (pass + 1),
      );
      const next = dedupeBy([
        ...markFamiliar(moreSearch, liked),
        ...unjudgedSearch,
        ...remaining.filter((track) => track.source === "saved"),
      ].filter((track) => matchesArtistConstraints(track, plan) && !seen.has(trackIdentity(track))), trackIdentity)
        .slice(0, Math.min(200, Math.max(30, plan.targetCount * 2)));
      if (!next.length) break;
      if (session && Date.now() < deadlineAt - 30_000) await markLibraryMembership(catalogToken, next);
      const refillEnrichStarted = Date.now();
      const outcome = await enrichCandidates(next, plan, evidence, {
        maxNewTracks: next.length,
        lastfmLimit: Math.min(16, Math.ceil(plan.targetCount * 0.4)),
        musicbrainzLimit: 1,
        deadlineAt,
        tagDefinitions,
        spotifyAccessToken: catalogToken,
      });
      enrichmentMs += Date.now() - refillEnrichStarted;
      const refillJudgeStarted = Date.now();
      const result = await scoreCandidates(outcome.candidates, plan, prompt, { tagDefinitions }, { localOnly: true });
      judgingMs += Date.now() - refillJudgeStarted;
      scored.push(...result.tracks);
      jevEvaluated += result.jevEvaluated;
    }
  } else {
    const result = await scoreCandidates(demoCatalog, plan, prompt, {}, { localOnly: true });
    scored = result.tracks;
    jevEvaluated = result.jevEvaluated;
  }

  const tracks = chooseTracks(scored, plan, prompt);
  if (!tracks.length) throw new Error("No tracks could be verified as a match for this request. Please retry or describe the sound in more detail.");
  const cover = await coverPromise;
  const familiar = tracks.filter((track) => track.familiar).length;
  const preferredAlbumKeys = new Set((plan.preferredAlbums ?? []).map(albumKey));
  console.info("[mix.generate]", {
    durationMs: Date.now() - startedAt,
    tasteMs,
    planningMs,
    retrievalMs,
    enrichmentMs,
    judgingMs,
    target: plan.targetCount,
    selected: tracks.length,
    jevEvaluated,
    preferredAlbums: plan.preferredAlbums ?? [],
    retrievedCandidates,
    resolvedAlbumTracks,
    preferredAlbumSelected: tracks.filter((track) => preferredAlbumKeys.has(albumKey(track.album))).length,
    preferredAlbumPassed: scored.filter((track) => track.meetsRequest && preferredAlbumKeys.has(albumKey(track.album))).length,
    jevPassed: scored.filter((track) => track.fitSource === "jev" && track.meetsRequest).length,
    jevBelowPointTwo: scored.filter((track) => track.fitSource === "jev" && (track.fitProbability ?? 0) < 0.2).length,
    withAudio: scored.filter((track) => track.energy != null || track.danceability != null).length,
    withTags: scored.filter((track) => Boolean(track.genres?.length || track.tags?.length)).length,
  });
  return {
    id: stableId(),
    userId: session?.user.accountId || session?.user.id || "demo",
    prompt,
    name: plan.name,
    description: plan.description,
    coverPrompt: plan.coverPrompt,
    coverDataUrl: cover?.dataUrl,
    tracks,
    targetCount: plan.targetCount,
    status: "draft",
    createdAt: Date.now(),
    stats: { familiar, discoveries: tracks.length - familiar, jevEvaluated },
  };
}
