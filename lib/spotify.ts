import type { MixPlan, MixTrack, SpotifySession } from "@/lib/types";
import { chunk, dedupeBy, mapConcurrent } from "@/lib/utils";
import { artistSearchQueries, matchesArtistConstraints } from "@/lib/artist-constraints";

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
  album: { name: string; images?: { url: string }[] };
  external_urls?: { spotify?: string };
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
    durationMs: track.duration_ms,
    explicit: track.explicit,
    imageUrl: track.album.images?.[0]?.url,
    spotifyUrl: track.external_urls?.spotify,
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
  return Boolean(track?.id && track.uri && !track.is_local && track.is_playable !== false && track.artists?.length);
}

async function getLikedTracks(token: string) {
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

export async function getTasteCandidates(session: SpotifySession, plan: MixPlan) {
  const token = session.accessToken;

  const queries = dedupeBy(plan.allowedArtists?.length ? artistSearchQueries(plan.allowedArtists) : plan.searchQueries, (query) => query).slice(0, 8);
  const perQuery = Math.ceil(Math.max(80, plan.targetCount * 2) / Math.max(1, queries.length));
  const [taste, searches] = await Promise.all([getLikedTracks(token), Promise.all(queries.map(async (query) => {
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
