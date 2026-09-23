import { afterEach, describe, expect, it, vi } from "vitest";
import { hasLastfm, stripHtml, tagInfo, trackInfo, trackSimilar, trackTopTags } from "./lastfm";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Last.fm client", () => {
  it("stays disabled without an API key", async () => {
    vi.stubEnv("LASTFM_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(hasLastfm()).toBe(false);
    expect(await trackTopTags({ track: "GHOST", artist: "Yel" })).toEqual([]);
    expect(await trackSimilar({ track: "GHOST", artist: "Yel" })).toEqual([]);
    expect(await tagInfo("indie")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses artist+track with autocorrect when no mbid is known", async () => {
    vi.stubEnv("LASTFM_API_KEY", "test-key");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/2.0/");
      expect(url.searchParams.get("method")).toBe("track.getTopTags");
      expect(url.searchParams.get("track")).toBe("GHOST");
      expect(url.searchParams.get("artist")).toBe("Yel");
      expect(url.searchParams.get("autocorrect")).toBe("1");
      expect(url.searchParams.get("api_key")).toBe("test-key");
      expect(url.searchParams.get("format")).toBe("json");
      return json({ toptags: { tag: [{ name: "indie", count: 90 }, { name: "seen live", count: 80 }] } });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await trackTopTags({ track: "GHOST", artist: "Yel" })).toEqual([
      { name: "indie", count: 90 },
      { name: "seen live", count: 80 },
    ]);
  });

  it("switches to the mbid identity when one is resolved", async () => {
    vi.stubEnv("LASTFM_API_KEY", "test-key");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("mbid")).toBe("mbid-1");
      expect(url.searchParams.get("track")).toBeNull();
      expect(url.searchParams.get("artist")).toBeNull();
      return json({ toptags: { tag: [] } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await trackTopTags({ mbid: "mbid-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null for a genuine not-found instead of throwing", async () => {
    vi.stubEnv("LASTFM_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: 7, message: "No track found with that name" })));

    expect(await trackInfo({ track: "nope", artist: "nobody" })).toBeNull();
  });

  it("returns tags and a stripped summary from track.getInfo", async () => {
    vi.stubEnv("LASTFM_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => json({
      track: {
        toptags: { tag: [{ name: "chill", count: 50 }] },
        wiki: { summary: '<a href="https://last.fm/music/Cher">Cher</a> is an American singer &amp; actress.' },
      },
    })));

    expect(await trackInfo({ track: "Believe", artist: "Cher" })).toEqual({
      tags: [{ name: "chill", count: 50 }],
      summary: "Cher is an American singer & actress.",
    });
    expect(stripHtml(undefined)).toBe("");
    expect(stripHtml("  plain   text ").length).toBeLessThanOrEqual(140);
  });

  it("normalizes similarity scores against the strongest match", async () => {
    vi.stubEnv("LASTFM_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => json({
      similartracks: { track: [
        { name: "Space Song", artist: { name: "Beach House" }, match: "4.5" },
        { name: "Myth", artist: { name: "Beach House" }, match: "9" },
        { name: "Broken", artist: { name: "" }, match: "1" },
      ] },
    })));

    expect(await trackSimilar({ mbid: "mbid-1" })).toEqual([
      { title: "Space Song", artist: "Beach House", match: 0.5 },
      { title: "Myth", artist: "Beach House", match: 1 },
    ]);
  });

  it("keeps sub-one match scales untouched", async () => {
    vi.stubEnv("LASTFM_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => json({
      similartracks: { track: [{ name: "A", artist: { name: "B" }, match: "0.75" }] },
    })));

    expect(await trackSimilar({ track: "x", artist: "y" })).toEqual([{ title: "A", artist: "B", match: 0.75 }]);
  });

  it("retries once on rate-limit error 29", async () => {
    vi.stubEnv("LASTFM_API_KEY", "test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: 29, message: "Rate limit exceeded" }))
      .mockResolvedValueOnce(json({ toptags: { tag: [{ name: "house", count: 10 }] } }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await trackTopTags({ track: "Massive", artist: "Drake" })).toEqual([{ name: "house", count: 10 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("returns a compact definition for plan terms", async () => {
    vi.stubEnv("LASTFM_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => json({
      tag: { name: "afrobeats", wiki: { summary: "<b>Afrobeats</b> is a music genre that originated in West Africa in the 2000s." } },
    })));

    const definition = await tagInfo("afrobeats");

    expect(definition).toContain("Afrobeats is a music genre");
    expect(definition!.length).toBeLessThanOrEqual(160);
  });
});
