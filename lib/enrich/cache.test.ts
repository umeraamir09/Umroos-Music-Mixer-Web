import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMemoryCacheForTests, getCache, putCache, refKey, tagKey, trackKey, type CacheEntry } from "./cache";

const { queryMock, mutationMock } = vi.hoisted(() => ({ queryMock: vi.fn(), mutationMock: vi.fn() }));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = (...args: unknown[]) => queryMock(...args);
    mutation = (...args: unknown[]) => mutationMock(...args);
  },
}));

beforeEach(() => {
  clearMemoryCacheForTests();
  queryMock.mockReset();
  mutationMock.mockReset();
  vi.stubEnv("CONVEX_URL", "");
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");
  vi.stubEnv("CONVEX_SERVICE_SECRET", "test-service-secret-at-least-32-characters");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("enrichment cache", () => {
  it("builds stable keys per track, reference and tag", () => {
    expect(trackKey({ id: "abc" })).toBe("sp:abc");
    expect(refKey("Yel", "GHOST")).toBe("ref:yel::ghost");
    expect(refKey(" yel ", "Ghost ")).toBe("ref:yel::ghost");
    expect(tagKey(" House ")).toBe("tag:house");
  });

  it("round-trips through memory when Convex is not configured", async () => {
    const entry: CacheEntry = { key: "sp:1", genres: ["house"], tags: ["club"], updatedAt: Date.now() };
    await putCache([entry]);

    expect(mutationMock).not.toHaveBeenCalled();
    const found = await getCache(["sp:1", "sp:missing"]);
    expect(found.size).toBe(1);
    expect(found.get("sp:1")?.genres).toEqual(["house"]);
    expect(found.get("sp:missing")).toBeUndefined();
  });

  it("ignores entries past the 90-day TTL", async () => {
    await putCache([{ key: "sp:1", isrc: "US-STALE-1", updatedAt: Date.now() - 91 * 24 * 60 * 60 * 1000 }]);

    const found = await getCache(["sp:1"]);

    expect(found.size).toBe(0);
  });

  it("loads misses from Convex and remembers them in memory", async () => {
    vi.stubEnv("CONVEX_URL", "https://convex.example");
    queryMock.mockResolvedValue([{ key: "sp:2", mbid: "mbid-2", updatedAt: Date.now() }]);

    const found = await getCache(["sp:2"]);

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(found.get("sp:2")?.mbid).toBe("mbid-2");

    // The second read is served from memory without another round trip.
    vi.stubEnv("CONVEX_URL", "");
    expect((await getCache(["sp:2"])).get("sp:2")?.mbid).toBe("mbid-2");
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("persists entries when Convex is configured", async () => {
    vi.stubEnv("CONVEX_URL", "https://convex.example");
    mutationMock.mockResolvedValue(1);

    await putCache([{ key: "sp:3", mbid: "mbid-3", updatedAt: 0 }]);

    expect(mutationMock).toHaveBeenCalledTimes(1);
    const payload = mutationMock.mock.calls[0][1] as { entries: CacheEntry[] };
    expect(payload.entries[0].key).toBe("sp:3");
    expect(payload.entries[0].updatedAt).toBeGreaterThan(0); // stamped at write time
  });

  it("survives a Convex outage while keeping the memory layer warm", async () => {
    vi.stubEnv("CONVEX_URL", "https://convex.example");
    mutationMock.mockRejectedValue(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await putCache([{ key: "sp:4", isrc: "US-ONLINE-4", updatedAt: Date.now() }]);

    expect(warn).toHaveBeenCalled();
    vi.stubEnv("CONVEX_URL", "");
    expect((await getCache(["sp:4"])).get("sp:4")?.isrc).toBe("US-ONLINE-4");
  });
});
