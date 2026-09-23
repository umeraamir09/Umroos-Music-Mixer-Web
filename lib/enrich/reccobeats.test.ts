import { afterEach, describe, expect, it, vi } from "vitest";
import { batchAudioFeatures, recommend, searchTracks, spotifyIdFromHref } from "./reccobeats";

const ID_A = "00aqkszH1FdUiJJWvX6iEl";
const ID_B = "35lJfZjNcXWkoyyXqQfZc1";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ReccoBeats client", () => {
  it("extracts Spotify IDs from canonical resource hrefs", () => {
    expect(spotifyIdFromHref(`https://open.spotify.com/track/${ID_A}?si=abc`)).toBe(ID_A);
    expect(spotifyIdFromHref("https://reccobeats.com/track/8e6f5f34-0f4e-4a44-9d02-2f4b0aa7d0b1")).toBeNull();
    expect(spotifyIdFromHref(undefined)).toBeNull();
  });

  it("batches audio features into groups of at most 40", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("/v1/audio-features?ids=");
      const ids = decodeURIComponent(url.split("ids=")[1]).split(",");
      expect(ids.length).toBeLessThanOrEqual(40);
      return json({
        content: ids.map((id) => ({
          href: `https://open.spotify.com/track/${id}`,
          isrc: "US-AAA-00-00001",
          energy: 0.5,
          danceability: 0.6,
          tempo: 120.5,
          valence: "0.44", // numbers arrive as strings too; the client coerces
        })),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const ids = Array.from({ length: 45 }, (_, index) => `000000${index}`.padStart(22, "A"));
    const features = await batchAudioFeatures([...ids, ids[0]]); // duplicates collapse

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sizes = fetchMock.mock.calls.map(([url]) => decodeURIComponent(String(url).split("ids=")[1]).split(",").length);
    expect(sizes).toEqual([40, 5]);
    expect(features.size).toBe(45);
    const first = features.get(ids[0]);
    expect(first).toMatchObject({ spotifyId: ids[0], isrc: "US-AAA-00-00001", energy: 0.5, valence: 0.44, tempo: 120.5 });
  });

  it("retries once after a 429 honoring Retry-After", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(json({ content: [{ href: `https://open.spotify.com/track/${ID_A}`, energy: 0.7 }] }));
    vi.stubGlobal("fetch", fetchMock);

    const features = await batchAudioFeatures([ID_A]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(features.get(ID_A)?.energy).toBe(0.7);
  }, 10_000);

  it("propagates hard failures so the orchestrator can fail open", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await expect(batchAudioFeatures([ID_A])).rejects.toThrow(/500/);
  }, 10_000);

  it("passes repeated seed parameters with a bounded size", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v1/track/recommendation");
      expect(url.searchParams.getAll("seeds")).toEqual([ID_A, ID_B]);
      expect(url.searchParams.get("size")).toBe("40");
      return json({
        content: [{
          href: `https://open.spotify.com/track/${ID_A}`,
          trackTitle: "Massive",
          artists: [{ name: "Drake" }],
          durationMs: 180_000,
          isrc: "US-TOXY-10-0016",
        }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const tracks = await recommend([ID_A, ID_B, ID_A], 40);

    expect(tracks).toEqual([{ spotifyId: ID_A, title: "Massive", artists: ["Drake"], durationMs: 180_000, isrc: "US-TOXY-10-0016" }]);
  });

  it("searches with the required searchText parameter", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v1/track/search");
      expect(url.searchParams.get("searchText")).toBe("ghost by yel");
      return json({ content: [{ href: `https://open.spotify.com/track/${ID_B}`, trackTitle: "GHOST", artists: [{ name: "Yel" }], durationMs: 200_000 }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const [track] = await searchTracks("ghost by yel");

    expect(track).toMatchObject({ spotifyId: ID_B, title: "GHOST", artists: ["Yel"] });
  });
});
