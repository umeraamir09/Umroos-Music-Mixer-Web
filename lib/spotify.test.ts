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
      if (url.pathname === "/v1/me/tracks") return json({ items: [catalogTrack("unrelated-taste", "SZA"), catalogTrack("match-0")].map((track) => ({ track })), total: 2 });
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
  it("retains old liked songs and requested discoveries without browsing other taste sources", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/v1/search") return json({ tracks: { items: [catalogTrack("requested-discovery")], next: null } });
      if (url.pathname === "/v1/me/tracks") {
        const offset = Number(url.searchParams.get("offset"));
        return json({ items: Array.from({ length: 50 }, (_, i) => ({ track: catalogTrack(`saved-${offset + i}`, "SZA") })), total: 500 });
      }
      if (url.pathname === "/v1/audio-features") return json({ audio_features: [] });
      return json({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const candidates = await getTasteCandidates(session, { ...fallbackPlan("club"), searchQueries: ["club"] });
    expect(candidates).toHaveLength(501);
    expect(candidates[0].id).toBe("requested-discovery");
    expect(candidates[0].familiar).toBe(false);
    expect(candidates.find((track) => track.id === "saved-499")).toMatchObject({ familiar: true, source: "saved" });
    expect(fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === "/v1/me/tracks")).toHaveLength(10);
    expect(fetchMock.mock.calls.some(([url]) => /top\/tracks|recently-played|playlists/.test(url))).toBe(false);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes("/audio-features"))).toHaveLength(1);
  });
  it("fails visibly when an older liked-song page is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/v1/me/tracks") return url.searchParams.get("offset") === "0"
        ? json({ items: [], total: 100 }) : new Response("rate limited", { status: 429 });
      return json({ tracks: { items: [], next: null } });
    }));
    await expect(getTasteCandidates(session, fallbackPlan("indie"))).rejects.toThrow("Could not read your complete Liked Songs library");
  });
  it("skips unavailable, local and removed likes without losing valid older tracks", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/v1/me/tracks") return json({ total: 5, items: [null, { ...catalogTrack("local"), is_local: true }, { ...catalogTrack("unavailable"), is_playable: false }, catalogTrack("valid"), catalogTrack("valid")].map((track) => ({ track })) });
      if (url.pathname === "/v1/audio-features") return json({ audio_features: [] });
      return json({ tracks: { items: [], next: null } });
    }));
    const candidates = await getTasteCandidates(session, fallbackPlan("indie"));
    expect(candidates.map((track) => track.id)).toEqual(["valid"]);
  });
});
