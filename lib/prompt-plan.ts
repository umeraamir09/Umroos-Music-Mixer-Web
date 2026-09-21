import type { EnergyBand, MixPlan } from "@/lib/types";
import { clamp, compactText } from "@/lib/utils";
import { artistSearchQueries, explicitArtistConstraints, KNOWN_ARTISTS } from "@/lib/artist-constraints";

const KNOWN_GENRES = ["house", "r&b", "indie", "jazz", "hip-hop", "pop", "electronic", "funk", "rock", "afrobeats", "soul"];

export function requestedTrackCount(prompt: string) {
  const match = prompt.match(/(?:at\s*least|atleast|about|around|roughly|exactly|add|with)?\s*(\d{1,3})\s*(?:songs?|tracks?)/i);
  if (!match) return 40;
  return clamp(Number(match[1]), 15, 200);
}

function inferEnergy(text: string): EnergyBand {
  if (/nothing too hype|not (?:too )?(?:loud|energetic)|sleepy|slow|soft|calm|relax|wind down/i.test(text)) return "low";
  if (/high energy|hype|workout|party|club|loud|run(?:ning)?/i.test(text)) return "high";
  if (/build|journey|arc|start slow|dynamic/i.test(text)) return "dynamic";
  return "medium";
}

function titleFor(prompt: string, genres: string[], energy: EnergyBand) {
  if (/late.?night|drive|road/i.test(prompt)) return "After Dark, In Motion";
  if (/rain/i.test(prompt)) return "Rain on the Window";
  if (/sleepy|woke up|morning/i.test(prompt)) return "Soft Start";
  if (/old gems?|forgotten|used to listen/i.test(prompt)) return "Found in the Fold";
  if (/house/i.test(prompt) && /drake/i.test(prompt)) return "Honestly, After Hours";
  if (/café|cafe|coffee/i.test(prompt)) return "Table by the Window";
  if (/fun|mix of genres/i.test(prompt)) return "A Little Bit of Everything";
  if (genres[0]) return `${genres[0][0].toUpperCase()}${genres[0].slice(1)} in the Air`;
  return energy === "low" ? "Easy Does It" : "Right Now, This";
}

export function fallbackPlan(prompt: string): MixPlan {
  const normalized = prompt.toLowerCase();
  const genres = KNOWN_GENRES.filter((genre) => normalized.includes(genre));
  if (!genres.length) genres.push(...(/\bclub\b/i.test(prompt) ? ["house", "hip-hop", "pop"] : ["r&b", "indie"]));
  const constraints = explicitArtistConstraints(prompt);
  const anchorArtists = [...new Set([...constraints.allowedArtists, ...KNOWN_ARTISTS.filter((artist) => normalized.includes(artist.toLowerCase()))])]
    .filter((artist) => !constraints.avoidArtists.includes(artist));
  const energy = inferEnergy(prompt);
  const entirelyNew = /entirely new|all new|only new|never heard/i.test(prompt);
  const veryFamiliar = /only (?:artists|songs) i (?:know|like)|usual artists|heard (?:the )?most|recently/i.test(prompt);
  const discoveryTarget = entirelyNew ? 0.9 : veryFamiliar ? 0.12 : 0.28;
  const targetCount = requestedTrackCount(prompt);
  const name = titleFor(prompt, genres, energy);
  const mood = energy === "low" ? "soft, spacious and unhurried" : energy === "high" ? "bright, kinetic and immediate" : "warm, fluid and quietly surprising";
  // Only bind a locally parsed title when the artist is unambiguous. The AI
  // planner handles multiple references and more complicated phrasing.
  const referenceName = prompt.match(/\b(?:song|track)\s+["“]?([^"”.!?;]+?)(?:["”]|$|[.!?;]|\s+(?:by|for|with|and|but|that|which)\b)/i)?.[1]?.trim();
  const referenceTracks = referenceName && anchorArtists.length === 1 ? [{ name: referenceName, artist: anchorArtists[0] }] : [];

  return {
    name,
    description: constraints.allowedArtists.length
      ? `A ${mood} mix drawn from ${constraints.allowedArtists.join(" and ")}.`
      : `A ${mood} mix that keeps your favourites close while making room for a few new discoveries.`,
    coverPrompt: compactText(`${mood} abstract music cover, ${genres.slice(0, 2).join(" and ")}, minimal cinematic illustration`, 150),
    targetCount,
    genres,
    moods: mood.split(", ").map((value) => value.replace("and ", "")),
    energy,
    anchorArtists,
    allowedArtists: constraints.allowedArtists,
    seedTracks: referenceTracks.map((track) => track.name),
    referenceTracks,
    soundProfile: compactText(`${genres.join(", ")}; ${energy} energy. ${prompt}`, 400),
    avoidArtists: constraints.avoidArtists,
    avoidTraits: /nothing too hype|not.*energetic/i.test(prompt) ? ["hype", "aggressive", "high energy"] : [],
    familiarityTarget: 1 - discoveryTarget,
    discoveryTarget,
    searchQueries: constraints.allowedArtists.length ? artistSearchQueries(constraints.allowedArtists) : [
      ...referenceTracks.map((track) => `track:"${track.name}" artist:"${track.artist}"`),
      ...anchorArtists.slice(0, 3).map((artist) => `artist:${artist}`),
      ...genres.slice(0, 3).map((genre) => `genre:${genre}`),
      `${genres[0]} ${energy === "low" ? "slow chill" : energy === "high" ? "upbeat" : "mix"}`,
    ].slice(0, 7),
    rationale: "Match the request first; use familiarity and discovery to choose among suitable tracks within its constraints.",
  };
}

export function normalizePlan(plan: MixPlan, prompt: string): MixPlan {
  const targetCount = requestedTrackCount(prompt);
  const discovery = clamp(Number(plan.discoveryTarget ?? 0.28), 0, 1);
  const explicit = explicitArtistConstraints(prompt, [...(plan.anchorArtists || []), ...(plan.allowedArtists || []), ...(plan.avoidArtists || [])]);
  const allowedArtists = explicit.allowedArtists.length ? explicit.allowedArtists : (plan.allowedArtists || []);
  return {
    ...plan,
    name: compactText(plan.name || fallbackPlan(prompt).name, 64),
    description: compactText(plan.description || fallbackPlan(prompt).description, 180),
    coverPrompt: compactText(plan.coverPrompt || fallbackPlan(prompt).coverPrompt, 180),
    targetCount,
    genres: (plan.genres || []).slice(0, 6),
    moods: (plan.moods || []).slice(0, 6),
    anchorArtists: (plan.anchorArtists || []).slice(0, 8),
    allowedArtists,
    seedTracks: (plan.seedTracks || []).slice(0, 8),
    referenceTracks: (plan.referenceTracks || fallbackPlan(prompt).referenceTracks).slice(0, 8),
    soundProfile: compactText(plan.soundProfile || fallbackPlan(prompt).soundProfile, 400),
    avoidArtists: [...new Set([...(plan.avoidArtists || []), ...explicit.avoidArtists])],
    avoidTraits: (plan.avoidTraits || []).slice(0, 8),
    discoveryTarget: discovery,
    familiarityTarget: clamp(1 - discovery, 0, 1),
    searchQueries: allowedArtists.length ? artistSearchQueries(allowedArtists) : (plan.searchQueries || []).filter(Boolean).slice(0, 8),
  };
}
