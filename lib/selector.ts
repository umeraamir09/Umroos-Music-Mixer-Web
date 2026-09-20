import { experimental_evaluate as evaluate, type Experimental_EvaluationQuestion } from "ai";
import type { MixPlan, MixTrack } from "@/lib/types";
import { chunk, dedupeBy } from "@/lib/utils";

const energyCenter = { low: 0.28, medium: 0.55, high: 0.82, dynamic: 0.58 } as const;

function localFit(track: MixTrack, plan: MixPlan, prompt: string) {
  const haystack = `${track.name} ${track.artists.join(" ")} ${track.album} ${(track.genres || []).join(" ")}`.toLowerCase();
  let score = 0.32;
  const anchorIndex = plan.anchorArtists.findIndex((artist) => track.artists.some((value) => value.toLowerCase() === artist.toLowerCase()));
  if (anchorIndex >= 0) score += anchorIndex === 0 ? 0.38 : 0.28;
  if (plan.seedTracks.some((seed) => track.name.toLowerCase().includes(seed.toLowerCase()))) score += 0.5;
  score += Math.min(0.26, plan.genres.filter((genre) => haystack.includes(genre.toLowerCase())).length * 0.16);
  if (plan.avoidArtists.some((artist) => track.artists.some((value) => value.toLowerCase() === artist.toLowerCase()))) score -= 1;
  if (track.energy != null) score += Math.max(-0.2, 0.2 - Math.abs(track.energy - energyCenter[plan.energy]) * 0.45);
  if (track.familiar) score += (plan.familiarityTarget - 0.5) * 0.24;
  else score += (plan.discoveryTarget - 0.3) * 0.24;
  const promptWords = prompt.toLowerCase().split(/[^a-z0-9&]+/).filter((word) => word.length > 3);
  score += Math.min(0.12, promptWords.filter((word) => haystack.includes(word)).length * 0.025);
  return Math.max(0.01, Math.min(0.99, score));
}

async function evaluateBatch(batch: MixTrack[], plan: MixPlan, prompt: string) {
  const questions: Record<string, Experimental_EvaluationQuestion> = {};
  batch.forEach((_, index) => {
    questions[`track_${index}`] = {
      type: "boolean",
      instructions: `Should candidate ${index} be included in this exact playlist? Weigh explicit constraints above generic similarity.`,
      criteria: {
        true: "It supports the requested genre, energy, situation, named artists/songs and familiarity-discovery balance without violating exclusions.",
        false: "It clashes with the request, violates an exclusion, is redundant, or weakens the requested vibe.",
      },
    };
  });

  const result = await evaluate({
    model: process.env.JEV_MODEL || "typesafe-ai/jev",
    state: {
      request: prompt,
      target: {
        genres: plan.genres,
        moods: plan.moods,
        energy: plan.energy,
        anchors: plan.anchorArtists,
        seeds: plan.seedTracks,
        avoidArtists: plan.avoidArtists,
        avoidTraits: plan.avoidTraits,
        familiarityTarget: plan.familiarityTarget,
      },
      candidates: batch.map((track, index) => ({
        index,
        title: track.name,
        artists: track.artists,
        album: track.album,
        genres: track.genres?.slice(0, 4),
        energy: track.energy == null ? undefined : Number(track.energy.toFixed(2)),
        danceability: track.danceability == null ? undefined : Number(track.danceability.toFixed(2)),
        familiar: track.familiar,
        source: track.source,
        explicit: Boolean(track.explicit),
      })),
    },
    questions,
    maxRetries: 1,
  });

  return batch.map((track, index) => {
    const answer = result.answers[`track_${index}`];
    return { ...track, fitProbability: answer?.type === "boolean" ? answer.probability : localFit(track, plan, prompt) };
  });
}

export async function scoreCandidates(candidates: MixTrack[], plan: MixPlan, prompt: string) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    return { tracks: candidates.map((track) => ({ ...track, fitProbability: localFit(track, plan, prompt) })), jevEvaluated: 0 };
  }

  try {
    const batches = chunk(candidates.slice(0, 150), 30);
    const scored: MixTrack[] = [];
    for (const group of batches) scored.push(...(await evaluateBatch(group, plan, prompt)));
    return { tracks: scored, jevEvaluated: scored.length };
  } catch (error) {
    console.warn("Jev evaluation fell back to local scoring:", error instanceof Error ? error.message : error);
    return { tracks: candidates.map((track) => ({ ...track, fitProbability: localFit(track, plan, prompt) })), jevEvaluated: 0 };
  }
}

function byFit(a: MixTrack, b: MixTrack) {
  return (b.fitProbability || 0) - (a.fitProbability || 0);
}

export function chooseTracks(candidates: MixTrack[], plan: MixPlan, prompt: string) {
  const unique = dedupeBy(candidates, (track) => `${track.name}::${track.artists[0]}`).sort(byFit);
  const count = Math.min(plan.targetCount, unique.length);
  const firstAnchor = plan.anchorArtists[0]?.toLowerCase();
  const wantsAnchorHeavy = firstAnchor && /(mainly|heavy|mostly|center(?:ed)? on|lots? of)/i.test(prompt);
  const selected: MixTrack[] = [];
  const selectedIds = new Set<string>();

  const take = (items: MixTrack[], amount: number) => {
    for (const track of items) {
      if (selected.length >= count || amount <= 0 || selectedIds.has(track.id)) continue;
      selected.push(track);
      selectedIds.add(track.id);
      amount -= 1;
    }
  };

  if (wantsAnchorHeavy) {
    const anchorTracks = unique.filter((track) => track.artists.some((artist) => artist.toLowerCase() === firstAnchor));
    take(anchorTracks, Math.min(anchorTracks.length, Math.ceil(count * 0.5)));
  }

  const desiredFamiliar = Math.round(count * plan.familiarityTarget);
  const familiarNeeded = Math.max(0, desiredFamiliar - selected.filter((track) => track.familiar).length);
  take(unique.filter((track) => track.familiar), familiarNeeded);
  take(unique.filter((track) => !track.familiar), count - selected.length);
  take(unique, count - selected.length);

  // Sequence for flow: retain quality while avoiding long single-artist runs.
  const pool = [...selected].sort(byFit);
  const sequenced: MixTrack[] = [];
  while (pool.length) {
    const lastArtist = sequenced.at(-1)?.artists[0];
    const index = pool.findIndex((track, position) => position < 7 && track.artists[0] !== lastArtist);
    sequenced.push(...pool.splice(index >= 0 ? index : 0, 1));
  }
  return sequenced;
}
