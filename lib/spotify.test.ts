import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpotifyPlaylist, getTasteCandidates } from "./spotify";
import { fallbackPlan } from "./prompt-plan";
import type { MixTrack, SpotifySession } from "./types";

const session: SpotifySession = {
  accessToken: "test-token",
  refreshToken: "test-refresh",
  expiresAt: Date.now() + 60_000,
  scope: "playlist-modify-private ugc-image-upload",
  user: { id: "listener", displayName: "Listener" },
};

const track: MixTrack = {
  id: "track-1",
  uri: "spotify:track:track-1",
  name: "Test Track",
  artists: ["Test Artist"],
  album: "Test Album",
  durationMs: 180_000,
  source: "search",
  familiar: false,
};

afterEach(() => vi.unstubAllGlobals());

describe("Spotify playlist saving", () => {
  it("accepts Spotify's empty successful cover-upload response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "playlist-1", external_urls: { spotify: "https://open.spotify.com/playlist/playlist-1" } }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ snapshot_id: "snapshot-1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const playlist = await createSpotifyPlaylist(session, "Test Mix", "Test description", [track], Buffer.from("jpeg"));

    expect(playlist.id).toBe("playlist-1");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toContain("/playlists/playlist-1/images");
  });
});

const catalogTrack = (id: string, artist = "Drake") => ({
  id, uri: `spotify:track:${id}`, name: id, duration_ms: 180000,
  artists: [{ id: artist, name: artist }], album: { name: "Album" },
});
const json = (body: unknown) => new Response(JSON.stringify(body));

describe("request-led candidate retrieval", () => {
  it("paginates artist searches and filters unrelated history and search matches", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/v1/search") {
        expect(url.searchParams.get("q")).toBe('artist:"Drake"');
        expect(url.searchParams.get("limit")).toBe("10");
        const offset = Number(url.searchParams.get("offset"));
        return json({ tracks: { items: offset === 0
          ? Array.from({ length: 10 }, (_, i) => catalogTrack(`match-${i}`))
          : [catalogTrack("match-10"), catalogTrack("unrelated-result", "Drake Tribute Band")],
        next: offset === 0 ? "next-page" : null } });
      }
      if (url.pathname === "/v1/me/top/tracks") return json({ items: [catalogTrack("unrelated-taste", "SZA"), catalogTrack("match-0")] });
      if (url.pathname === "/v1/audio-features") return json({ audio_features: [] });
      return json({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const candidates = await getTasteCandidates(session, fallbackPlan("A Drake only club music playlist."));
    expect(candidates).toHaveLength(11);
    expect(candidates.every((track) => track.artists.includes("Drake"))).toBe(true);
    expect(candidates.find((track) => track.id === "match-0")?.familiar).toBe(true);
    expect(candidates.find((track) => track.id === "match-10")?.familiar).toBe(false);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes("/search?"))).toHaveLength(2);
  });
  it("does not let a large taste history crowd requested discoveries out", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/v1/search") return json({ tracks: { items: [catalogTrack("requested-discovery")], next: null } });
      if (url.pathname === "/v1/me/top/tracks") return json({ items: Array.from({ length: 50 }, (_, i) => catalogTrack(`${url.searchParams.get("time_range")}-${i}`, "SZA")) });
      if (url.pathname === "/v1/me/tracks") return json({ items: Array.from({ length: 50 }, (_, i) => ({ track: catalogTrack(`saved-${i}`, "SZA") })) });
      if (url.pathname === "/v1/audio-features") return json({ audio_features: [] });
      return json({ items: [] });
    }));
    const candidates = await getTasteCandidates(session, { ...fallbackPlan("club"), searchQueries: ["club"] });
    expect(candidates).toHaveLength(180);
    expect(candidates[0].id).toBe("requested-discovery");
    expect(candidates[0].familiar).toBe(false);
  });
});
