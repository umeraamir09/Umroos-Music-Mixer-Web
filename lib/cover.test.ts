import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createCover, coverBufferFromDataUrl, normalizeCustomCover } from "@/lib/cover";
import type { MixPlan } from "@/lib/types";

const plan: MixPlan = {
  name: "Test Mix",
  description: "A test mix",
  coverPrompt: "A warm abstract landscape",
  targetCount: 1,
  genres: [],
  moods: [],
  energy: "medium",
  anchorArtists: [],
  allowedArtists: [],
  seedTracks: [],
  referenceTracks: [],
  soundProfile: "",
  avoidArtists: [],
  avoidTraits: [],
  familiarityTarget: 0.72,
  discoveryTarget: 0.28,
  searchQueries: [],
  rationale: "",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("normalizeCustomCover", () => {
  it("makes an imported image a 1024px JPEG within Spotify's upload limit", async () => {
    const source = await sharp({ create: { width: 1200, height: 800, channels: 4, background: "#ec809c" } }).png().toBuffer();
    const jpeg = await normalizeCustomCover(`data:image/png;base64,${source.toString("base64")}`);
    const metadata = await sharp(jpeg).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(1024);
    expect(metadata.height).toBe(1024);
    expect(jpeg.toString("base64").length).toBeLessThanOrEqual(256 * 1024);
  });

  it("rejects non-image data URLs", async () => {
    await expect(normalizeCustomCover("data:text/plain;base64,SGVsbG8=")).rejects.toThrow("JPEG, PNG, or WebP");
  });
});

describe("createCover", () => {
  it.each([
    ["result.image", (image: string) => ({ result: { image } })],
    ["image with a data URI prefix", (image: string) => ({ image: `data:image/png;charset=utf-8;base64,${image}` })],
  ])("decodes Cloudflare %s into a square JPEG", async (_label, responseData) => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-token");
    vi.stubEnv("CLOUDFLARE_AI_GATEWAY_ID", "");
    const source = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#875c43" } })
      .png().toBuffer();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("@cf/black-forest-labs/flux-1-schnell");
      expect(init?.method).toBe("POST");
      return new Response(
        JSON.stringify(responseData(source.toString("base64"))),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const cover = await createCover(plan);
    const metadata = await sharp(cover.jpeg).metadata();

    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(1024);
    expect(metadata.height).toBe(1024);
    expect(cover.dataUrl.length - "data:image/jpeg;base64,".length).toBeLessThanOrEqual(256 * 1024);
    expect(coverBufferFromDataUrl(cover.dataUrl)).toEqual(cover.jpeg);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("@cf/black-forest-labs/flux-1-schnell");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).has("cf-aig-gateway-id")).toBe(false);
  });

  it("keeps the local SVG fallback when Cloudflare credentials are absent", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const cover = await createCover(plan);
    const metadata = await sharp(cover.jpeg).metadata();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(metadata.height);
    expect(cover.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
  });
});
