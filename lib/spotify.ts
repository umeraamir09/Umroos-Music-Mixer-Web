import type { MixPlan, MixTrack, SpotifySession } from "@/lib/types";
import { chunk, dedupeBy, mapConcurrent } from "@/lib/utils";
import { artistSearchQueries, matchesArtistConstraints } from "@/lib/artist-constraints";
import { albumKey } from "@/lib/prompt-plan";

const API = "https://api.spotify.com/v1";

type SpotifyTrack = {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  explicit?: boolean;
  is_local?: boolean;
  is_playable?: boolean;
  artists: { id: string; name: string }[];
  album: { name: string; images?: { url: string }[]; release_date?: string };
  external_ids?: { isrc?: string };
  external_urls?: { spotify?: string };
};

type SpotifyAlbum = {
  id: string;
  name: string;
  artists: { name: string }[];
  images?: { url: string }[];
  release_date?: string;
};

async function spotifyFetch<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Spotify ${response.status}: ${detail.slice(0, 240)}`);
  }

  // Several Spotify write endpoints return a successful response with no body
  // (notably custom cover uploads). Calling response.json() on those responses
  // throws "Unexpected end of JSON input", even though the request succeeded.
  const body = await response.text();
  if (!body.trim()) return undefined as T;

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`Spotify returned an invalid JSON response for ${path}.`);
  }
}

function toMixTrack(track: SpotifyTrack, source: MixTrack["source"], familiar: boolean): MixTrack {
  return {
    id: track.id,
    uri: track.uri,
    name: track.name,
    artists: track.artists.map((artist) => artist.name),
    album: track.album.name,
    releaseYear: track.album.release_date && /^\d{4}/.test(track.album.release_date)
      ? Number(track.album.release_date.slice(0, 4)) : undefined,
    durationMs: track.duration_ms,
    explicit: track.explicit,
    imageUrl: track.album.images?.[0]?.url,
    spotifyUrl: track.external_urls?.spotify,
    isrc: track.external_ids?.isrc,
    source,
    familiar,
  };
}

async function safe<T>(fallback: T, operation: () => Promise<T>) {
  try { return await operation(); } catch { return fallback; }
}

export async function refreshSpotifySession(session: SpotifySession) {
  if (session.expiresAt > Date.now() + 60_000) return session;
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: session.refreshToken });
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Spotify session expired. Please connect again.");
  const data = await response.json();
  return { ...session, accessToken: data.access_token, refreshToken: data.refresh_token || session.refreshToken, expiresAt: Date.now() + data.expires_in * 1000 };
}

type SavedTrackPage = { items: { track: SpotifyTrack | null }[]; total: number };

function availableTrack(track: SpotifyTrack | null): track is SpotifyTrack {
  return Boolean(track?.id && track.uri && track.album?.name && !track.is_local && track.is_playable !== false && track.artists?.length);
}

export async function getLikedTracksPreview(token: string): Promise<SavedTrackPage> {
  return spotifyFetch<SavedTrackPage>(token, "/me/tracks?limit=50&offset=0", { signal: AbortSignal.timeout(8000) });
}

// Read a bounded cross-section of a large library. The first page shapes the
// plan; the remaining pages span the whole history and run while AI plans.
export async function getLikedTracksSample(token: string, first: SavedTrackPage, maxPages = 8): Promise<MixTrack[]> {
  const totalPages = Math.ceil(Math.max(0, first.total) / 50);
  const otherPages = Math.min(Math.max(0, maxPages - 1), Math.max(0, totalPages - 1));
  const pageNumbers = [...new Set(Array.from({ length: otherPages }, (_, index) =>
    1 + Math.round(index * (totalPages - 2) / Math.max(1, otherPages - 1)),
  ))];
  const pages = await mapConcurrent(pageNumbers, 8, async (page) => safe<SavedTrackPage | null>(null, () =>
    spotifyFetch<SavedTrackPage>(token, `/me/tracks?limit=50&offset=${page * 50}`, { signal: AbortSignal.timeout(8000) }),
  ));
  return dedupeBy([first, ...pages.filter((page): page is SavedTrackPage => Boolean(page))]
    .flatMap((page) => page.items.map(({ track }) => track).filter(availableTrack).map((track) => toMixTrack(track, "saved", true))), (track) => track.id);
}

export async function searchSpotifyCandidates(
  token: string,
  queries: string[],
  budget: number,
  startPage = 0,
): Promise<MixTrack[]> {
  const unique = dedupeBy(queries.filter(Boolean), (query) => query).slice(0, 8);
  const active = unique.filter((query) => startPage === 0 || !/\btrack\s*:/i.test(query));
  if (!active.length) return [];
  const broadCount = Math.max(1, active.filter((query) => !/\btrack\s*:/i.test(query)).length);
  const pagesPerBroad = Math.max(1, Math.ceil(Math.max(budget, active.length * 10) / (10 * broadCount)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const fetchPage = async (query: string, page: number) => safe<{ tracks: { items: SpotifyTrack[]; next?: string | null } }>(
    { tracks: { items: [], next: null } },
    () => controller.signal.aborted
      ? Promise.resolve({ tracks: { items: [], next: null } })
      : spotifyFetch(token, `/search?type=track&limit=10&offset=${page * 10}&q=${encodeURIComponent(query)}`,
        { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) }),
  );
  try {
    const first = await mapConcurrent(active, 4, (query) => fetchPage(query, startPage));
    const tasks = active.flatMap((query, index) => {
      if (/\btrack\s*:/i.test(query) || !first[index].tracks.next) return [];
      return Array.from({ length: pagesPerBroad - 1 }, (_, page) => ({ query, page: startPage + page + 1 }));
    });
    const extra = await mapConcurrent(tasks, 4, ({ query, page }) => fetchPage(query, page));
    return dedupeBy([...first, ...extra]
      .flatMap((result) => result.tracks.items.filter(availableTrack).map((track) => toMixTrack(track, "search", false))),
    (track) => `${track.name}::${track.artists[0]}`);
  } finally {
    clearTimeout(timer);
  }
}

// Album search alone returns a small, ranked sample of songs. Resolve the
// actual release, then page through its track list so a majority-album request
// can see every eligible recording. Exact normalized title and artist checks
// guard against similarly named releases by other performers.
export async function getPreferredAlbumCandidates(token: string, plan: MixPlan): Promise<MixTrack[]> {
  const artist = plan.anchorArtists[0] || plan.allowedArtists[0];
  const wanted = (plan.preferredAlbums ?? []).slice(0, 6);
  if (!wanted.length) return [];
  const albums = await mapConcurrent(wanted, 4, async (title) => {
    const variants = [...new Set([title, title.replace(/honor/gi, "honour"), title.replace(/honour/gi, "honor")])];
    for (const variant of variants) {
      const query = `album:"${variant.replace(/"/g, "")}"${artist ? ` artist:"${artist.replace(/"/g, "")}"` : ""}`;
      const response = await safe<{ albums?: { items?: SpotifyAlbum[] } }>({}, () =>
        spotifyFetch(token, `/search?type=album&limit=10&q=${encodeURIComponent(query)}`,
          { signal: AbortSignal.timeout(8000) }),
      );
      const hit = response.albums?.items?.find((album) => album?.id && albumKey(album.name) === albumKey(title)
        && (!artist || album.artists?.some((credit) => credit.name.normalize("NFKC").toLowerCase() === artist.normalize("NFKC").toLowerCase())));
      if (hit) return hit;
    }
    return null;
  });
  const found = dedupeBy(albums.filter((album): album is SpotifyAlbum => Boolean(album)), (album) => album.id);
  const results = await mapConcurrent(found, 4, async (album) => {
    const tracks: MixTrack[] = [];
    for (let offset = 0; offset < 200; offset += 50) {
      const page = await safe<{ items: Omit<SpotifyTrack, "album">[]; next?: string | null }>(
        { items: [], next: null },
        () => spotifyFetch(token, `/albums/${encodeURIComponent(album.id)}/tracks?limit=50&offset=${offset}`,
          { signal: AbortSignal.timeout(8000) }),
      );
      tracks.push(...page.items.map((item) => ({ ...item, album: album as SpotifyTrack["album"] }))
        .filter(availableTrack).map((track) => toMixTrack(track, "search", false)));
      if (!page.next || page.items.length < 50) break;
    }
    return tracks;
  });
  return dedupeBy(results.flat(), (track) => `${track.name}::${track.artists[0]}`.toLowerCase());
}

export async function getLikedTracks(token: string) {
  const readPage = (offset: number) => spotifyFetch<SavedTrackPage>(token, `/me/tracks?limit=50&offset=${offset}`, { signal: AbortSignal.timeout(10000) });
  try {
    const first = await readPage(0);
    if (!Number.isSafeInteger(first.total) || first.total < 0) throw new Error("Invalid library response");
    const offsets = Array.from({ length: Math.max(0, Math.ceil(first.total / 50) - 1) }, (_, index) => (index + 1) * 50);
    const pages = [first, ...await mapConcurrent(offsets, 4, readPage)];
    return dedupeBy(pages.flatMap((page) => page.items.map(({ track }) => track).filter(availableTrack).map((track) => toMixTrack(track, "saved", true))), (track) => track.id);
  } catch {
    // A failed library read is not an empty library, and must not silently switch
    // to recent listening or only the newest saved page.
    throw new Error("Could not read your complete Liked Songs library. Please retry; if this continues, reconnect Spotify to restore library access.");
  }
}

// `preloadedTaste` lets the engine fetch the library once, summarize it for
// the planner, and hand the same result to retrieval (no second library read).
export async function getTasteCandidates(session: SpotifySession, plan: MixPlan, preloadedTaste?: MixTrack[]) {
  const token = session.accessToken;

  const queries = dedupeBy(plan.allowedArtists?.length ? artistSearchQueries(plan.allowedArtists) : plan.searchQueries, (query) => query).slice(0, 8);
  const perQuery = Math.ceil(Math.max(80, plan.targetCount * 2) / Math.max(1, queries.length));
  const [taste, searches] = await Promise.all([preloadedTaste ?? getLikedTracks(token), Promise.all(queries.map(async (query) => {
    const tracks: MixTrack[] = [];
    // Search is limited to 10 tracks per page. Retrieve enough of a restricted
    // catalog to select for vibe, rather than filling from unrelated taste data.
    for (let offset = 0; offset < perQuery; offset += 10) {
      const result = await safe<{ tracks: { items: SpotifyTrack[]; next?: string | null } }>({ tracks: { items: [], next: null } }, () =>
        spotifyFetch(token, `/search?type=track&limit=10&offset=${offset}&q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(8000) }),
      );
      tracks.push(...result.tracks.items.filter(availableTrack).map((track) => toMixTrack(track, "search", false)));
      if (result.tracks.next === null || result.tracks.items.length < 10) break;
    }
    return tracks;
  }))]);
  const familiarById = new Map(taste.map((track) => [track.id, track]));
  const familiarByName = new Map(taste.map((track) => [`${track.name}::${track.artists[0]}`.toLowerCase(), track]));
  const discoveries = searches.flat().map((track) => {
    const known = familiarById.get(track.id) || familiarByName.get(`${track.name}::${track.artists[0]}`.toLowerCase());
    return known ? { ...track, familiar: true, source: known.source } : track;
  });
  // Keep every eligible liked song, regardless of when it was saved. Jev judges
  // the library's musical fit before selection; recency is not a shortlist.
  const candidates = dedupeBy([...discoveries, ...taste].filter((track) => matchesArtistConstraints(track, plan)), (track) => `${track.name}::${track.artists[0]}`);

  // Audio features are enrichment only; some Spotify app modes do not expose them.
  const ids = candidates.map((track) => track.id);
  // Probe once before requesting the rest: app modes without audio features
  // should not pay for dozens of guaranteed failures on a large library.
  const groups = chunk(ids, 100);
  const enrich = async (idGroup: string[]) => {
    const audio = await safe<{ audio_features: ({ id: string; energy: number; danceability: number } | null)[] }>({ audio_features: [] }, () =>
      spotifyFetch(token, `/audio-features?ids=${idGroup.join(",")}`, { signal: AbortSignal.timeout(8000) }),
    );
    const map = new Map(audio.audio_features.filter(Boolean).map((item) => [item!.id, item!]));
    candidates.forEach((track) => {
      const features = map.get(track.id);
      if (features) { track.energy = features.energy; track.danceability = features.danceability; }
    });
    return audio.audio_features.some(Boolean);
  };
  if (groups.length && await enrich(groups[0])) await mapConcurrent(groups.slice(1), 4, enrich);
  return candidates;
}

// Spotify-canonical identity for a Last.fm lookup: the string-based Last.fm
// endpoints (track.getTopTags/getInfo/getSimilar) are queried with Spotify's
// own track and artist names instead of a MusicBrainz mbid. Fail-open: null
// on any miss or outage, so callers fall back to their existing identity
// paths (mbid, then raw planner strings + autocorrect).
export async function resolveSpotifyIdentity(
  accessToken: string,
  title: string,
  artist: string,
): Promise<{ track: string; artist: string } | null> {
  const query = `track:"${title.replace(/"/g, "")}" artist:"${artist.replace(/"/g, "")}"`;
  try {
    const result = await spotifyFetch<{ tracks?: { items?: SpotifyTrack[] } }>(
      accessToken,
      `/search?type=track&limit=1&q=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    const hit = result.tracks?.items?.[0];
    const track = hit?.name?.trim();
    const primary = hit?.artists?.[0]?.name?.trim();
    const comparable = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    return track && primary && comparable(track) === comparable(title) && comparable(primary) === comparable(artist)
      ? { track, artist: primary }
      : null;
  } catch {
    return null;
  }
}

export type SpotifyIdentity = { name: string; artists: string[] };

export async function fetchCatalogTracks(accessToken: string, ids: string[]): Promise<Map<string, MixTrack>> {
  const tracks = new Map<string, MixTrack>();
  // The batched GET /tracks endpoint was removed for Spotify dev-mode apps.
  // Single-track GET /tracks/{id} remains available; cap parallel reads.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  let results: (SpotifyTrack | null)[];
  try {
    results = await mapConcurrent([...new Set(ids.filter(Boolean))], 6, async (id) =>
      controller.signal.aborted ? null : safe<SpotifyTrack | null>(null, () =>
        spotifyFetch<SpotifyTrack>(accessToken, `/tracks/${encodeURIComponent(id)}`,
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) }),
      ),
    );
  } finally {
    clearTimeout(timer);
  }
  for (const track of results) {
    if (availableTrack(track)) tracks.set(track.id, toMixTrack(track, "search", false));
  }
  return tracks;
}

let spotifyAudioUnavailable = false;

export async function fillSpotifyAudioFeatures(accessToken: string, candidates: MixTrack[]): Promise<number> {
  if (spotifyAudioUnavailable) return 0;
  const missing = candidates.filter((track) => track.energy == null || track.danceability == null);
  const groups = chunk(missing.map((track) => track.id), 100);
  if (!groups.length) return 0;
  type AudioResponse = { audio_features?: ({ id: string; energy: number; danceability: number } | null)[] };
  const read = (ids: string[]) => spotifyFetch<AudioResponse>(accessToken, `/audio-features?ids=${ids.join(",")}`, { signal: AbortSignal.timeout(8000) });
  let first: AudioResponse;
  try {
    first = await read(groups[0]);
  } catch (error) {
    if (error instanceof Error && /Spotify (403|404)/.test(error.message)) spotifyAudioUnavailable = true;
    return 0;
  }
  if (!first.audio_features?.some(Boolean)) return 0;
  const rest = await mapConcurrent(groups.slice(1), 4, (ids) => safe<AudioResponse>({}, () => read(ids)));
  const byId = new Map([first, ...rest].flatMap((response) => response.audio_features ?? [])
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .map((value) => [value.id, value]));
  let filled = 0;
  for (const track of missing) {
    const value = byId.get(track.id);
    if (!value) continue;
    if (track.energy == null) track.energy = value.energy;
    if (track.danceability == null) track.danceability = value.danceability;
    filled += 1;
  }
  return filled;
}

export async function markLibraryMembership(accessToken: string, candidates: MixTrack[]): Promise<void> {
  const unknown = candidates.filter((track) => !track.familiar && track.id);
  const groups = chunk(unknown, 40);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    await mapConcurrent(groups, 4, async (group) => {
      if (controller.signal.aborted) return;
      const uris = group.map((track) => track.uri || `spotify:track:${track.id}`);
      const flags = await safe<boolean[] | null>(null, () => spotifyFetch<boolean[]>(
        accessToken,
        `/me/library/contains?uris=${encodeURIComponent(uris.join(","))}`,
        { signal: controller.signal },
      ));
      if (!Array.isArray(flags) || flags.length !== group.length) return;
      group.forEach((track, index) => { if (flags[index] === true) track.familiar = true; });
    });
  } finally {
    clearTimeout(timer);
  }
}

// Canonical names for callers that only need the identity strings.
export async function fetchTrackNames(accessToken: string, ids: string[]): Promise<Map<string, SpotifyIdentity>> {
  const names = new Map<string, SpotifyIdentity>();
  for (const track of (await fetchCatalogTracks(accessToken, ids)).values()) {
    names.set(track.id, { name: track.name, artists: track.artists });
  }
  return names;
}

export function summarizeTaste(tracks: MixTrack[]) {
  const liked = tracks.filter((track) => track.source === "saved");
  const artists = new Map<string, number>();
  liked.forEach((track) => track.artists.forEach((artist) => artists.set(artist, (artists.get(artist) || 0) + 1)));
  const topArtists = [...artists.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([artist]) => artist);
  return `Liked artists: ${topArtists.join(", ")}. Liked song examples: ${liked.slice(0, 20).map((track) => `${track.name} — ${track.artists[0]}`).join("; ")}`;
}

export async function createSpotifyPlaylist(session: SpotifySession, name: string, description: string, tracks: MixTrack[], coverJpeg?: Buffer) {
  const playlist = await spotifyFetch<{ id: string; external_urls: { spotify: string } }>(session.accessToken, "/me/playlists", {
    method: "POST",
    body: JSON.stringify({ name, description, public: false }),
  });
  const uris = tracks.map((track) => track.uri).filter((uri): uri is string => Boolean(uri));
  for (const group of chunk(uris, 100)) {
    await spotifyFetch(session.accessToken, `/playlists/${playlist.id}/items`, { method: "POST", body: JSON.stringify({ uris: group }) });
  }
  if (coverJpeg) {
    await spotifyFetch<void>(session.accessToken, `/playlists/${playlist.id}/images`, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: coverJpeg.toString("base64"),
    });
  }
  return playlist;
}
