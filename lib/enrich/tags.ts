// Community tag normalization for Last.fm (and MusicBrainz free-form tags).
//
// Raw tagging data is noisy: scrobble-context tags ("seen live"), vague praise
// ("awesome"), and era tags ("90s") sit next to real style labels. This module
// filters, aliases, classifies and caps tags so only compact, meaningful
// evidence reaches Jev.

export type TagCount = { name: string; count: number };

const JUNK_TAGS = new Set([
  "seen live",
  "favorites",
  "favourite",
  "favourites",
  "favorite",
  "favourites?",
  "love",
  "loved",
  "likes",
  "awesome",
  "cool",
  "beautiful",
  "best",
  "amazing",
  "perfect",
  "perfection",
  "guilty pleasure",
  "guilty pleasures",
  "spotify",
  "checked",
  "check out",
  "checked out",
  "want to see live",
  "to check out",
  "my music",
  "playlist",
  "playlists",
  "good",
  "nice",
  "binge",
  "repeat",
  "favorite artists",
  "under 2000 characters",
  "all time favorite",
  "favoritesong",
]);

const ALIASES: Record<string, string> = {
  "hip-hop": "hip hop",
  "hiphop": "hip hop",
  "hip hop music": "hip hop",
  "rnb": "r&b",
  "r and b": "r&b",
  "rhythm and blues": "r&b",
  "contemporary r&b": "r&b",
  "k-pop": "k pop",
  "lo-fi": "lo fi",
  "lofi": "lo fi",
  "drum & bass": "drum and bass",
  "dnb": "drum and bass",
  "electronica": "electronic",
  "dance music": "dance",
};

// Single-word genre anchors used for the "does this tag end with a genre?"
// heuristic (e.g. "indie pop" -> pop, "alternative hip hop" -> hip hop).
const SINGLE_GENRES = [
  "pop", "rock", "house", "techno", "trance", "disco", "metal", "punk", "jazz", "blues",
  "soul", "funk", "gospel", "reggae", "dancehall", "afrobeats", "amapiano", "rap", "folk",
  "country", "ambient", "indie", "garage", "grime", "drill", "trap", "dubstep", "hardcore",
];

// Multi-word genres (exact match only after alias normalization).
const MULTI_GENRES = [
  "hip hop", "r&b", "afrobeat", "classical", "electronic", "lo fi", "bedroom pop", "art pop",
  "synthpop", "synth pop", "dream pop", "indie pop", "pop rock", "folk rock", "psychedelic rock",
  "alternative rock", "progressive rock", "hard rock", "heavy metal", "death metal", "k pop",
  "drum and bass", "orchestral", "soundtrack", "new wave", "post rock", "shoegaze", "bossa nova",
];

const GENRE_SET = new Set([...SINGLE_GENRES, ...MULTI_GENRES]);

const ERA_PATTERN = /^\d{2}s$|^\d{4}s$/;
const ERA_WORDS = new Set([
  "oldies", "classic", "classics", "vintage", "retro", "modern", "contemporary", "throwback",
  "60s", "70s", "80s", "90s", "2000s", "2010s", "2020s",
]);

function canonical(raw: string): string {
  const cleaned = raw.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  return ALIASES[cleaned] || cleaned;
}

export function isJunkTag(tag: string): boolean {
  return JUNK_TAGS.has(tag);
}

export function isEraTag(tag: string): boolean {
  return ERA_PATTERN.test(tag) || ERA_WORDS.has(tag);
}

export function isGenreTag(tag: string): boolean {
  if (GENRE_SET.has(tag)) return true;
  // Compound forms inherit the genre they end with:
  // "indie pop", "alternative hip hop", "conscious rap"...
  return [...SINGLE_GENRES, ...MULTI_GENRES].some((genre) => tag.endsWith(` ${genre}`));
}

export type NormalizedTags = {
  /** Compact mood/scene/descriptor tags, era tags last, count-weighted, ≤ maxTags. */
  tags: string[];
  /** Style labels only — trusted inputs bypass the genre vocabulary check. */
  genres: string[];
};

/**
 * Normalizes count-weighted tags: junk-filtered, alias-collapsed, deduped by
 * highest count, then split into `genres` (genre vocabulary matches, or every
 * item when `trusted` — MusicBrainz's curated genre list) and `tags`
 * (count-ordered with era tags last).
 */
export function normalizeTags(raw: TagCount[], options: { trusted?: boolean; maxTags?: number; maxGenres?: number } = {}): NormalizedTags {
  const maxTags = options.maxTags ?? 6;
  const maxGenres = options.maxGenres ?? 6;
  const best = new Map<string, number>();
  for (const { name, count } of raw) {
    const tag = canonical(String(name ?? ""));
    if (!tag || tag.length > 40 || isJunkTag(tag)) continue;
    const weight = Number.isFinite(count) ? Math.max(0, count) : 0;
    if ((best.get(tag) ?? -1) < weight) best.set(tag, weight);
  }
  const ordered = [...best.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));

  const genres = ordered
    .filter((entry) => options.trusted || isGenreTag(entry.name))
    .slice(0, maxGenres)
    .map((entry) => entry.name);

  const tags = [
    ...ordered.filter((entry) => !isEraTag(entry.name)),
    ...ordered.filter((entry) => isEraTag(entry.name)),
  ]
    .slice(0, maxTags)
    .map((entry) => entry.name);

  return { tags, genres };
}
