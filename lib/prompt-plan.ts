import type { EnergyBand, MixPlan } from "@/lib/types";
import { clamp, compactText } from "@/lib/utils";
import { artistSearchQueries, explicitArtistConstraints, KNOWN_ARTISTS } from "@/lib/artist-constraints";

const KNOWN_GENRES = ["house", "r&b", "indie", "jazz", "hip-hop", "pop", "electronic", "funk", "rock", "afrobeats", "soul", "reggaeton", "amapiano", "ambient", "classical", "country", "metal", "blues", "folk", "punk", "trap", "drill", "shoegaze", "gospel", "latin"];
const KNOWN_MOODS = ["sad", "dreamy", "melancholic", "happy", "dark", "cozy", "uplifting", "mellow", "chill", "romantic", "nostalgic", "peaceful", "soft", "sleepy"];
const escapeTerm = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function albumKey(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/honour/g, "honor")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function requestedAlbums(prompt: string): string[] {
  // Quoted titles after "album(s)" are reliable even when a title contains
  // punctuation or the word "and". Unquoted names need planner assistance.
  const albums = prompt.match(/\balbums?\b([^.!?\n]{0,240})/i)?.[1] ?? "";
  return [...albums.matchAll(/["“”']([^"“”']{2,80})["“”']/g)]
    .map((match) => match[1].trim()).filter(Boolean).slice(0, 8);
}

function explicitTrackCount(prompt: string): number | null {
  const match = prompt.match(/\b(?:at\s*least\s+|atleast\s+|about\s+|around\s+|roughly\s+|exactly\s+|add\s+|with\s+)?(\d{1,5})\s*-?\s*(?:songs?|tracks?)\b/i)
    ?? prompt.match(/\b(?:playlist|mix)\s+(?:of|with)\s+(\d{1,5})\b/i);
  return match ? clamp(Number(match[1]), 1, 200) : null;
}

export function requestedTrackCount(prompt: string) {
  return explicitTrackCount(prompt) ?? 40;
}

function inferEnergy(text: string): EnergyBand {
  if (/nothing too hype|not (?:too )?(?:loud|energetic)|sleepy|slow|soft|calm|relax|wind down/i.test(text)) return "low";
  if (/high energy|hype|workout|party|loud|run(?:ning)?/i.test(text)) return "high";
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
  const avoided = [...KNOWN_GENRES, ...KNOWN_MOODS].filter((value) =>
    new RegExp(`\\b(?:no|not|without|avoid|exclude|excluding)\\s+(?:too\\s+)?${escapeTerm(value)}\\b`, "i").test(prompt),
  );
  const genres = KNOWN_GENRES.filter((genre) => !avoided.includes(genre) && new RegExp(`(?:^|[^a-z])${escapeTerm(genre)}(?:$|[^a-z])`, "i").test(prompt));
  const moods = KNOWN_MOODS.filter((value) => !avoided.includes(value) && new RegExp(`\\b${value}\\b`, "i").test(prompt));
  // A setting such as "club" is not proof that the user requested house or
  // hip-hop. Invented genres narrow retrieval and reject otherwise good songs.
  const constraints = explicitArtistConstraints(prompt);
  const anchorArtists = [...new Set([...constraints.allowedArtists, ...KNOWN_ARTISTS.filter((artist) => normalized.includes(artist.toLowerCase()))])]
    .filter((artist) => !constraints.avoidArtists.includes(artist));
  const energy = inferEnergy(prompt);
  const entirelyNew = /entirely new|all new|only new|never heard/i.test(prompt);
  const veryFamiliar = /only (?:artists|songs) i (?:know|like)|usual artists|heard (?:the )?most|recently/i.test(prompt);
  const discoveryTarget = entirelyNew ? 0.9 : veryFamiliar ? 0.12 : 0.28;
  const targetCount = explicitTrackCount(prompt) ?? (/\b(?:short|quick|mini)\b/i.test(prompt) ? 15 : /\b(?:long|extended)\b/i.test(prompt) ? 60 : 40);
  const name = titleFor(prompt, genres, energy);
  const mood = energy === "low" ? "soft, spacious and unhurried" : energy === "high" ? "bright, kinetic and immediate" : "warm, fluid and quietly surprising";
  const context = prompt.match(/\b(?:late night|night drive|road trip|study|focus|workout|party|rainy day)\b/i)?.[0];
  const searchText = [genres[0], moods[0], context].filter(Boolean).join(" ")
    || prompt.replace(/\b\d{1,5}\s*-?\s*(?:songs?|tracks?)\b/gi, "")
      .replace(/\b(?:make|create|build|me|a|an|playlist|mix|of|songs|tracks|please)\b/gi, " ")
      .replace(/\s+/g, " ").trim().slice(0, 60)
    || "music";
  // Only bind a locally parsed title when the artist is unambiguous. The AI
  // planner handles multiple references and more complicated phrasing.
  const referenceName = prompt.match(/\b(?:song|track)\s+["“]?([^"”.!?;]+?)(?:["”]|$|[.!?;]|\s+(?:by|for|with|and|but|that|which)\b)/i)?.[1]?.trim();
  const referenceTracks = referenceName && anchorArtists.length === 1 ? [{ name: referenceName, artist: anchorArtists[0] }] : [];
  const preferredAlbums = requestedAlbums(prompt);

  return {
    name,
    description: constraints.allowedArtists.length
      ? `A ${mood} mix drawn from ${constraints.allowedArtists.join(" and ")}.`
      : `A ${mood} mix that keeps your favourites close while making room for a few new discoveries.`,
    coverPrompt: compactText(`${mood} abstract music cover, ${genres.slice(0, 2).join(" and ")}, minimal cinematic illustration`, 150),
    targetCount,
    genres,
    moods,
    energy,
    anchorArtists,
    preferredAlbums,
    allowedArtists: constraints.allowedArtists,
    seedTracks: referenceTracks.map((track) => track.name),
    referenceTracks,
    soundProfile: compactText([genres.join(", "), energy !== "medium" ? `${energy} energy` : "", context ?? ""].filter(Boolean).join("; "), 400),
    avoidArtists: constraints.avoidArtists,
    avoidTraits: [...new Set([...avoided, ...(/nothing too hype|not.*energetic/i.test(prompt) ? ["hype", "aggressive", "high energy"] : [])])],
    familiarityTarget: 1 - discoveryTarget,
    discoveryTarget,
    searchQueries: constraints.allowedArtists.length ? artistSearchQueries(constraints.allowedArtists) : [
      ...referenceTracks.map((track) => `track:"${track.name}" artist:"${track.artist}"`),
      ...preferredAlbums.slice(0, 4).map((album) => `album:"${album.replace(/"/g, "")}"${anchorArtists[0] ? ` artist:"${anchorArtists[0].replace(/"/g, "")}"` : ""}`),
      ...anchorArtists.slice(0, 3).map((artist) => `artist:${artist}`),
      ...genres.slice(0, 3).map((genre) => `genre:${genre}`),
      searchText,
    ].slice(0, 7),
    rationale: "Match the request first; use familiarity and discovery to choose among suitable tracks within its constraints.",
  };
}

export function normalizePlan(plan: MixPlan, prompt: string): MixPlan {
  const targetCount = explicitTrackCount(prompt) ?? clamp(Number(plan.targetCount) || 40, 1, 200);
  const discovery = clamp(Number(plan.discoveryTarget ?? 0.28), 0, 1);
  const local = fallbackPlan(prompt);
  const explicitAvoid = new Set(local.avoidTraits.map((value) => value.toLowerCase()));
  const explicit = explicitArtistConstraints(prompt, [...(plan.anchorArtists || []), ...(plan.allowedArtists || []), ...(plan.avoidArtists || [])]);
  // Guard against a planner turning "mostly X" or "like X" into a hard
  // one-artist catalog. Keep AI-parsed scopes only with a hard-scope cue.
  const hardScopeCue = /\b(?:every|all|entire|exclusively|solely|nothing but)\b.{0,80}\b(?:recording|song|track|catalog|music|by|from|within)\b/i.test(prompt);
  const allowedArtists = explicit.allowedArtists.length ? explicit.allowedArtists : hardScopeCue ? (plan.allowedArtists || []) : [];
  const albumNames = local.preferredAlbums?.length ? local.preferredAlbums
    : (plan.preferredAlbums ?? []).filter((name) => albumKey(prompt).includes(albumKey(name)));
  const preferredAlbums = [...new Map(albumNames
    .filter((name) => typeof name === "string" && albumKey(name))
    .map((name) => [albumKey(name), name.trim()] as const)).values()].slice(0, 8);
  return {
    ...plan,
    name: compactText(plan.name || local.name, 64),
    description: compactText(plan.description || local.description, 180),
    coverPrompt: compactText(plan.coverPrompt || local.coverPrompt, 180),
    targetCount,
    genres: (plan.genres || []).filter((value) => !explicitAvoid.has(value.toLowerCase())).slice(0, 6),
    moods: (plan.moods || []).filter((value) => !explicitAvoid.has(value.toLowerCase())).slice(0, 6),
    anchorArtists: [...new Set([...(local.anchorArtists ?? []), ...(plan.anchorArtists || [])])].slice(0, 8),
    preferredAlbums,
    // A club setting describes dance suitability; it does not by itself ask
    // for maximum energy. Keep an explicit "club bangers" cue high.
    energy: /\bclub\b/i.test(prompt) && !/\b(high.?energy|hype|upbeat|intense|hard.?hitting|bangers?|rave|party|workout|energetic)\b/i.test(prompt)
      ? "medium" : plan.energy,
    allowedArtists,
    seedTracks: (plan.seedTracks || []).slice(0, 8),
    referenceTracks: (plan.referenceTracks || local.referenceTracks).slice(0, 8),
    soundProfile: compactText(plan.soundProfile || local.soundProfile, 400),
    avoidArtists: [...new Set([...(plan.avoidArtists || []), ...explicit.avoidArtists])],
    avoidTraits: [...new Set([...(plan.avoidTraits || []), ...local.avoidTraits])].slice(0, 8),
    discoveryTarget: discovery,
    familiarityTarget: clamp(1 - discovery, 0, 1),
    searchQueries: allowedArtists.length ? artistSearchQueries(allowedArtists) : [...new Set([
      ...local.searchQueries.filter((query) => query.startsWith('track:"')),
      ...(plan.searchQueries || []).filter(Boolean),
      ...local.searchQueries,
    ])].slice(0, 8),
  };
}
