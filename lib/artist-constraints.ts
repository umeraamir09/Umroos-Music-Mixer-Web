import type { MixPlan, MixTrack } from "@/lib/types";
import { dedupeBy } from "@/lib/utils";

export const KNOWN_ARTISTS = ["Drake", "SZA", "Frank Ocean", "The Weeknd", "Daniel Caesar", "Yel", "Beach House", "KAYTRANADA", "Tame Impala", "Clairo", "ODESZA"];

const artistKey = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function explicitArtistConstraints(prompt: string, hints: string[] = []) {
  const names = dedupeBy([...KNOWN_ARTISTS, ...hints].filter(Boolean), artistKey);
  // Recognize common unambiguous forms for artists outside the small demo catalog.
  const rawScopes = [
    prompt.match(/^(?:(?:make|create|build)(?: me)?\s+)?(?:an?\s+)?(.+?)\s*-?\s*\bonly\b/i)?.[1],
    prompt.match(/\b(?:only|exclusively|nothing but)\s+(?:(?:songs|tracks|music)\s+(?:by|from)\s+)(.+?)(?=$|[.!?;]|\s+(?:for|with|that|but)\b)/i)?.[1],
    prompt.match(/^(?:only|exclusively|nothing but)\s+(.+?)(?=$|[.!?;]|\s+(?:songs|tracks|music|playlist|for)\b)/i)?.[1],
  ].filter((value): value is string => Boolean(value));
  for (const scope of rawScopes) {
    if (/\b(?:not|only|new|familiar|artists?|songs?|tracks?|music|playlist|like|know|want|include|house|pop|rock|jazz|hip-hop|r&b|club|chill|live|remixes|instrumental|clean)\b/i.test(scope)) continue;
    for (const name of scope.split(/\s+(?:and|or|&)\s+|,\s*/)) {
      const clean = name.trim().replace(/^["“]|["”]$/g, "");
      if (clean && clean.length <= 80 && !names.some((value) => artistKey(value) === artistKey(clean))) names.push(clean);
    }
  }
  const artistPattern = names.sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
  const listPattern = `(?:${artistPattern})(?:\\s*(?:,\\s*(?:and\\s+)?|and\\s+|or\\s+|&\\s*)(?:${artistPattern}))*`;
  const scopes = new RegExp(`(?<![\\p{L}\\p{N}])(${listPattern})\\s*(?:-\\s*)?(?:only|exclusively)\\b|\\b(?:only|exclusively|nothing but)\\s+(?:(?:songs|tracks|music)\\s+(?:by|from)\\s+)?(${listPattern})(?![\\p{L}\\p{N}])`, "giu");
  const allowedArtists: string[] = [];
  for (const match of prompt.matchAll(scopes)) {
    if (/\b(?:not|isn't|aren't)\s*$/i.test(prompt.slice(0, match.index))) continue;
    const scope = match[1] || match[2];
    allowedArtists.push(...names.filter((name) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(name)}(?![\\p{L}\\p{N}])`, "iu").test(scope)));
  }
  const avoidArtists = names.filter((name) => new RegExp(`\\b(?:no|without|avoid|exclude|excluding)\\s+${escapeRegex(name)}(?![\\p{L}\\p{N}])`, "iu").test(prompt));
  return { allowedArtists: dedupeBy(allowedArtists, artistKey), avoidArtists };
}

export function matchesArtistConstraints(track: MixTrack, plan: Pick<MixPlan, "allowedArtists" | "avoidArtists">) {
  const credits = track.artists.map(artistKey);
  if (plan.avoidArtists.some((artist) => credits.includes(artistKey(artist)))) return false;
  return !plan.allowedArtists?.length || plan.allowedArtists.some((artist) => credits.includes(artistKey(artist)));
}

export function artistSearchQueries(artists: string[]) {
  return artists.map((artist) => `artist:"${artist.replace(/"/g, "")}"`);
}
