import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateJev } from "@/lib/jev";
import { fallbackPlan } from "./prompt-plan";
import { chooseTracks, scoreCandidates } from "./selector";
import type { MixTrack } from "./types";

vi.mock("@/lib/jev", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jev")>();
  return { ...actual, evaluateJev: vi.fn() };
});
const evaluateMock = vi.mocked(evaluateJev);
const prompt = "A Drake only club music playlist.";
const makeTrack = (id: string, artists = ["Drake"], familiar = false, fitProbability = 0.9): MixTrack => ({
  id, name: id, artists, familiar, fitProbability, meetsRequest: true, album: "Album", durationMs: 180000, source: "search",
});

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); evaluateMock.mockReset(); });

describe("request-first selection", () => {
  it("never fills artist-only playlists with unrelated taste or discoveries", () => {
    const tracks = chooseTracks([
      makeTrack("familiar-drake", ["Drake"], true, 0.8),
      makeTrack("new-drake"),
      makeTrack("taste", ["SZA"], true, 0.99),
      makeTrack("discovery", ["KAYTRANADA"], false, 0.99),
      makeTrack("Drake tribute", ["Drake Tribute Band"], false, 1),
    ], fallbackPlan(prompt), prompt);
    expect(tracks.map((track) => track.id).sort()).toEqual(["familiar-drake", "new-drake"]);
  });
  it("accepts credited collaborations, but an excluded collaborator takes precedence", () => {
    const plan = { ...fallbackPlan(prompt), avoidArtists: ["SZA"] };
    const tracks = chooseTracks([
      makeTrack("collab", ["Future", " DRAKE "]), makeTrack("excluded-collab", ["Drake", "SZA"]),
    ], plan, prompt);
    expect(tracks.map((track) => track.id)).toEqual(["collab"]);
  });
  it("does not sacrifice musical fit to meet a familiar/discovery quota", () => {
    const candidates = [
      ...Array.from({ length: 15 }, (_, i) => makeTrack(`strong-${i}`, ["Drake"], false, 0.95)),
      ...Array.from({ length: 15 }, (_, i) => makeTrack(`weak-${i}`, ["Drake"], true, 0.51)),
    ];
    expect(chooseTracks(candidates, fallbackPlan(prompt), `${prompt} 15 songs`).every((track) => track.id.startsWith("strong-"))).toBe(true);
  });
  it("still personalizes among similarly suitable tracks", () => {
    const candidates = [
      ...Array.from({ length: 15 }, (_, i) => makeTrack(`new-${i}`, ["Drake"], false, 0.95)),
      ...Array.from({ length: 15 }, (_, i) => makeTrack(`known-${i}`, ["Drake"], true, 0.94)),
    ];
    expect(chooseTracks(candidates, fallbackPlan(prompt), `${prompt} 15 songs`).filter((track) => track.familiar)).toHaveLength(11);
  });
  it("enforces restrictions without AI or after an evaluation outage", async () => {
    const candidates = [{ ...makeTrack("allowed"), genres: ["house"], energy: 0.8 }, makeTrack("blocked", ["SZA"], true)];
    vi.stubEnv("OPENCODE_API_KEY", "");
    expect((await scoreCandidates(candidates, fallbackPlan(prompt), prompt)).tracks.map((track) => track.id)).toEqual(["allowed"]);
    vi.stubEnv("OPENCODE_API_KEY", "test");
    evaluateMock.mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await scoreCandidates(candidates, fallbackPlan(prompt), prompt);
    expect(result.jevEvaluated).toBe(0);
    expect(chooseTracks(result.tracks, fallbackPlan(prompt), prompt).map((track) => track.id)).toEqual(["allowed"]);
  });
});

describe("Jev's musical-fit role", () => {
  it("evaluates only eligible artists, rejects off-vibe recordings and omits taste quotas", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "test");
    evaluateMock.mockResolvedValue({ answers: {
      track_0: { type: "noul", noul: 0.95 },
      track_1: { type: "noul", noul: 0.1 },
    } } as never);
    const result = await scoreCandidates([makeTrack("club"), makeTrack("ballad", ["Drake"], true), makeTrack("wrong-artist", ["SZA"])], fallbackPlan(prompt), prompt);
    expect(result.jevEvaluated).toBe(2);
    expect(chooseTracks(result.tracks, fallbackPlan(prompt), prompt).map((track) => track.id)).toEqual(["club"]);
    const input = evaluateMock.mock.calls[0][0];
    const state = input.state as { judgingRules: string; target: Record<string, unknown>; candidates: Record<string, unknown>[] };
    expect(state.target.allowedArtists).toEqual(["Drake"]);
    expect(state.target).not.toHaveProperty("familiarityTarget");
    expect(state.candidates).toHaveLength(2);
    expect(state.candidates[0]).not.toHaveProperty("familiar");
    expect(state.candidates[0]).not.toHaveProperty("source");
    expect(state.judgingRules).toContain("Artist membership alone is insufficient");
    expect(state.judgingRules).toContain("Do not reject a track merely because other tracks have the same artist");
  });
  it("sends JSON-compatible state for tracks missing genres and audio features", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "test");
    evaluateMock.mockImplementation(async ({ state }) => {
      const scan = (value: unknown): void => {
        expect(value).not.toBe(undefined);
        if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
        if (Array.isArray(value)) value.forEach(scan);
        else if (value !== null && typeof value === "object") Object.values(value).forEach(scan);
      };
      scan(state);
      const candidates = (state as { candidates: Record<string, unknown>[] }).candidates;
      expect(candidates[0]).not.toHaveProperty("genres");
      expect(candidates[0]).not.toHaveProperty("energy");
      return { answers: { track_0: { type: "noul", noul: 0.9 } } } as never;
    });
    const track: MixTrack = { ...makeTrack("bare", ["Drake"]), genres: undefined, energy: undefined, danceability: NaN };
    const result = await scoreCandidates([track], fallbackPlan(prompt), prompt);
    expect(evaluateMock).toHaveBeenCalledTimes(1);
    expect(result.jevEvaluated).toBe(1);
  });
  it("preserves earlier rejections when another batch fails", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "test");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    evaluateMock.mockResolvedValueOnce({ answers: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`track_${i}`, { type: "noul", noul: 0.1 }])) } as never)
      .mockRejectedValueOnce(new Error("offline"));
    const result = await scoreCandidates(Array.from({ length: 61 }, (_, i) => makeTrack(`track-${i}`)), fallbackPlan(prompt), prompt);
    expect(result.jevEvaluated).toBe(60);
    expect(chooseTracks(result.tracks, fallbackPlan(prompt), prompt)).toEqual([]);
  });
  it("does not silently discard candidates after the old 150-track cutoff", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "test");
    evaluateMock.mockImplementation(async ({ questions }) => ({ answers: Object.fromEntries(Object.keys(questions).map((id) => [id, { type: "noul", noul: 0.9 }])) }) as never);
    const result = await scoreCandidates(Array.from({ length: 180 }, (_, i) => makeTrack(`track-${i}`)), fallbackPlan(prompt), prompt);
    expect(result.tracks).toHaveLength(180);
    expect(result.jevEvaluated).toBe(180);
  });
});

describe("soft reference sound and liked-song fit", () => {
  const request = "Create a playlist with a soft indie vibe like yel's music and her recent song GHOST";
  const liked = (id: string): MixTrack => ({ ...makeTrack(id, ["Another artist"], true), source: "saved" });

  it("requires an affirmative fit decision even when a song is liked", () => {
    const plan = fallbackPlan(request);
    const selected = chooseTracks([
      { ...liked("unscored"), meetsRequest: undefined, fitProbability: undefined },
      { ...liked("uncertain"), meetsRequest: true, fitProbability: 0.4 },
      { ...liked("rejected"), meetsRequest: false },
      { ...liked("wrong-energy"), energy: 0.9 },
      liked("verified-soft-indie"),
    ], plan, request);
    expect(selected.map((track) => track.id)).toEqual(["verified-soft-indie"]);
  });

  it("rejects unknown, title-only, and loud matches when Jev is unavailable", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "");
    const plan = fallbackPlan(request);
    const candidates = [
      liked("unknown"),
      { ...liked("title-only"), name: "GHOST" },
      { ...liked("wrong-genre"), genres: ["r&b"], energy: 0.2 },
      { ...liked("too-loud"), genres: ["indie"], energy: 0.9 },
      { ...liked("good-fit"), genres: ["indie"], energy: 0.25 },
      { ...liked("reference"), name: "GHOST", artists: ["Yel"] },
    ];
    const result = await scoreCandidates(candidates, plan, request);
    expect(chooseTracks(result.tracks, plan, request).map((track) => track.id).sort()).toEqual(["good-fit", "reference"]);
    expect(result.jevEvaluated).toBe(0);
  });

  it("does not turn missing, malformed or borderline Jev answers into liked-song approvals", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "test");
    evaluateMock.mockResolvedValue({ answers: {
      track_0: { type: "noul", noul: 0.4 },
      track_1: { type: "noul", noul: NaN },
      track_3: { type: "noul", noul: 0.95 },
    } } as never);
    const result = await scoreCandidates([liked("borderline"), liked("invalid"), liked("missing"), liked("fits")], fallbackPlan(request), request);
    expect(result.jevEvaluated).toBe(2);
    expect(chooseTracks(result.tracks, fallbackPlan(request), request).map((track) => track.id)).toEqual(["fits"]);
    const state = evaluateMock.mock.calls[0][0].state as { target: { referenceTracks: unknown; soundProfile: string }; judgingRules: string };
    expect(state.target.referenceTracks).toEqual([{ name: "GHOST", artist: "Yel" }]);
    expect(state.target.soundProfile).toContain("soft indie");
    expect(state.judgingRules).toContain("if the recording is unfamiliar");
  });

  it("evaluates older likes in compact batches with bounded concurrent decisions", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "test");
    let active = 0;
    let peak = 0;
    evaluateMock.mockImplementation(async ({ questions, state }) => {
      active++;
      peak = Math.max(peak, active);
      expect(Object.keys(questions).length).toBeLessThanOrEqual(60);
      expect(JSON.stringify(questions).length).toBeLessThan(40000);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      const candidates = (state as { candidates: { title: string }[] }).candidates;
      return { answers: Object.fromEntries(candidates.map((track, index) => [`track_${index}`, { type: "noul", noul: track.title === "old-like-299" ? 0.95 : 0.1 }])) } as never;
    });
    const result = await scoreCandidates(Array.from({ length: 300 }, (_, index) => liked(`old-like-${index}`)), fallbackPlan(request), request);
    expect(result.jevEvaluated).toBe(300);
    expect(evaluateMock).toHaveBeenCalledTimes(5);
    expect(peak).toBe(4);
    expect(chooseTracks(result.tracks, fallbackPlan(request), request).map((track) => track.id)).toEqual(["old-like-299"]);
  });
});

describe("deterministic enrichment reaches Jev", () => {
  it("includes audio, tags, similarity and definitions without popularity fields", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "test");
    evaluateMock.mockImplementation(async ({ state }) => {
      const captured = state as { target: Record<string, unknown>; candidates: Record<string, unknown>[]; judgingRules: string };
      const candidate = captured.candidates[0];
      expect(candidate.genres).toEqual(["house", "electronic", "dance", "disco", "funk", "garage"]);
      expect(candidate.tags).toEqual(["club", "groovy", "late night"]);
      expect(candidate.tagSummary).toBe("A propulsive club track.");
      expect(candidate.audio).toEqual({
        energy: 0.78,
        danceability: 0.7,
        tempo: 121.5,
        valence: 0.61,
        acousticness: 0.12,
        instrumentalness: 0.02,
        speechiness: 0.04,
        liveness: 0.11,
        loudness: -5.4,
      });
      expect(candidate.similarTo).toEqual([{ ref: "Yel — GHOST", match: 0.9 }]);
      // Popularity and taste stay hidden from the judge.
      expect(candidate).not.toHaveProperty("familiar");
      expect(candidate).not.toHaveProperty("source");
      expect(candidate).not.toHaveProperty("popularity");
      expect(candidate).not.toHaveProperty("familiarity");
      expect(captured.target.tagDefinitions).toEqual({ indie: "Soft guitar-led music." });
      expect(captured.judgingRules).toContain("listening-data similarity");
      expect(captured.judgingRules).toContain("Absent fields are unknown, not neutral");
      return { answers: { track_0: { type: "noul", noul: 0.9 } } } as never;
    });
    const track: MixTrack = {
      ...makeTrack("enriched"),
      genres: ["house", "electronic", "dance", "disco", "funk", "garage"],
      tags: ["club", "groovy", "late night"],
      tagSummary: "A propulsive club track.",
      energy: 0.78,
      danceability: 0.7,
      tempo: 121.5,
      valence: 0.61,
      acousticness: 0.12,
      instrumentalness: 0.02,
      speechiness: 0.04,
      liveness: 0.11,
      loudness: -5.4,
      similarTo: [{ ref: "Yel — GHOST", match: 0.9 }],
      mbid: "mbid-1",
      isrc: "US-1",
    };

    const result = await scoreCandidates([track], fallbackPlan(prompt), prompt, {
      tagDefinitions: { indie: "Soft guitar-led music." },
    });

    expect(result.jevEvaluated).toBe(1);
    expect(evaluateMock).toHaveBeenCalledTimes(1);
  });

  it("caps genres, tags and similarity entries and omits absent evidence entirely", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "test");
    evaluateMock.mockImplementation(async ({ state }) => {
      const captured = state as { target: Record<string, unknown>; candidates: Record<string, unknown>[] };
      const candidate = captured.candidates[0];
      expect(candidate.genres).toHaveLength(6);
      expect(candidate.tags).toHaveLength(6);
      expect((candidate.similarTo as unknown[]).length).toBeLessThanOrEqual(3);
      // No enrichment context -> no definitions key at all.
      expect(captured.target).not.toHaveProperty("tagDefinitions");
      return { answers: { track_0: { type: "noul", noul: 0.9 } } } as never;
    });
    const track: MixTrack = {
      ...makeTrack("capped"),
      genres: ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8"],
      tags: ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9"],
      similarTo: [
        { ref: "Yel — GHOST", match: 0.9 },
        { ref: "Yel — GHOST", match: 0.8 },
        { ref: "Yel — GHOST", match: 0.7 },
        { ref: "Yel — GHOST", match: 0.6 },
      ],
    };

    expect((await scoreCandidates([track], fallbackPlan(prompt), prompt)).jevEvaluated).toBe(1);
  });
});
