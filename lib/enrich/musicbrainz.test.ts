import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupIsrc, recordingTags, searchRecording } from "./musicbrainz";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("MusicBrainz client", () => {
  it("sends a User-Agent and resolves ISRCs to recording MBIDs", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://musicbrainz.org/ws/2/isrc/US-TOXY-10-0016?fmt=json");
      expect((init?.headers as Record<string, string>)["User-Agent"]).toContain("UmroosMusicMixer");
      return json({ recordings: [{ id: "mbid-1" }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await lookupIsrc("US-TOXY-10-0016")).toBe("mbid-1");
  });

  it("honors a custom MusicBrainz agent", async () => {
    vi.stubEnv("MUSICBRAINZ_AGENT", "MyApp/1.0 (contact@example.com)");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["User-Agent"]).toBe("MyApp/1.0 (contact@example.com)");
      return json({ recordings: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await lookupIsrc("US-000-00-00000")).toBeNull();
  });

  it("treats a 404 as a genuine miss without retrying", async () => {
    const fetchMock = vi.fn(async () => json({ error: "Not Found" }, 404));
    vi.stubGlobal("fetch", fetchMock);

    expect(await lookupIsrc("US-000-00-00000")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates outages after one retry so callers fail open, not negative", async () => {
    const fetchMock = vi.fn(async () => new Response("upstream down", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(lookupIsrc("US-000-00-00001")).rejects.toThrow(/HTTP 500/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("builds an encoded recording+artist query and trusts only high scores", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("/ws/2/recording?query=");
      expect(url).toContain("fmt=json");
      expect(decodeURIComponent(url)).toContain('recording:"GHOST" AND artist:"Yel"');
      return json({ recordings: [{ id: "mbid-low", score: 74 }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await searchRecording("GHOST", "Yel")).toBeNull();

    fetchMock.mockImplementation(async () => json({ recordings: [{ id: "mbid-high", score: 96 }] }));
    expect(await searchRecording("GHOST", 'Ye"l')).toBe("mbid-high");
  });

  it("parses curated genres and free-form tags from the recording lookup", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://musicbrainz.org/ws/2/recording/mbid-1?inc=genres+tags&fmt=json");
      return json({
        genres: [{ name: "alternative rock", count: 42 }],
        tags: [{ name: "british", count: 20 }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await recordingTags("mbid-1")).toEqual({
      genres: [{ name: "alternative rock", count: 42 }],
      tags: [{ name: "british", count: 20 }],
    });
  });

  it("lets outages from the recording lookup escape as exceptions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    await expect(recordingTags("mbid-1")).rejects.toThrow(/HTTP 500/);
  }, 10_000);
});
