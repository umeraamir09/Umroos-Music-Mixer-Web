import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpotifyPlaylist } from "./spotify";
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
