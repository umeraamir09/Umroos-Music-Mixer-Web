import { afterEach, describe, expect, it, vi } from "vitest";
import { experimental_evaluate as evaluate } from "ai";
import { fallbackPlan } from "./prompt-plan";
import { chooseTracks, scoreCandidates } from "./selector";
import type { MixTrack } from "./types";

vi.mock("ai", () => ({ experimental_evaluate: vi.fn() }));
const evaluateMock = vi.mocked(evaluate);
const prompt = "A Drake only club music playlist.";
const makeTrack = (id: string, artists = ["Drake"], familiar = false, fitProbability = 0.9): MixTrack => ({
  id, name: id, artists, familiar, fitProbability, album: "Album", durationMs: 180000, source: "search",
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
    const candidates = [makeTrack("allowed"), makeTrack("blocked", ["SZA"], true)];
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    expect((await scoreCandidates(candidates, fallbackPlan(prompt), prompt)).tracks.map((track) => track.id)).toEqual(["allowed"]);
    vi.stubEnv("AI_GATEWAY_API_KEY", "test");
    evaluateMock.mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await scoreCandidates(candidates, fallbackPlan(prompt), prompt);
    expect(result.jevEvaluated).toBe(0);
    expect(chooseTracks(result.tracks, fallbackPlan(prompt), prompt).map((track) => track.id)).toEqual(["allowed"]);
  });
});

describe("Jev's musical-fit role", () => {
  it("evaluates only eligible artists, rejects off-vibe recordings and omits taste quotas", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test");
    evaluateMock.mockResolvedValue({ answers: {
      track_0: { type: "boolean", probability: 0.95 },
      track_1: { type: "boolean", probability: 0.1 },
    } } as never);
    const result = await scoreCandidates([makeTrack("club"), makeTrack("ballad", ["Drake"], true), makeTrack("wrong-artist", ["SZA"])], fallbackPlan(prompt), prompt);
    expect(result.jevEvaluated).toBe(2);
    expect(chooseTracks(result.tracks, fallbackPlan(prompt), prompt).map((track) => track.id)).toEqual(["club"]);
    const input = evaluateMock.mock.calls[0][0];
    const state = input.state as { target: Record<string, unknown>; candidates: Record<string, unknown>[] };
    expect(state.target.allowedArtists).toEqual(["Drake"]);
    expect(state.target).not.toHaveProperty("familiarityTarget");
    expect(state.candidates).toHaveLength(2);
    expect(state.candidates[0]).not.toHaveProperty("familiar");
    expect(state.candidates[0]).not.toHaveProperty("source");
    expect(input.questions.track_0.instructions).toContain("Artist membership alone is insufficient");
    expect(input.questions.track_0.instructions).toContain("Do not reject a track merely because other tracks have the same artist");
  });
  it("preserves earlier rejections when another batch fails", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    evaluateMock.mockResolvedValueOnce({ answers: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`track_${i}`, { type: "boolean", probability: 0.1 }])) } as never)
      .mockRejectedValueOnce(new Error("offline"));
    const result = await scoreCandidates(Array.from({ length: 31 }, (_, i) => makeTrack(`track-${i}`)), fallbackPlan(prompt), prompt);
    expect(result.jevEvaluated).toBe(30);
    expect(chooseTracks(result.tracks, fallbackPlan(prompt), prompt).map((track) => track.id)).toEqual(["track-30"]);
  });
  it("does not silently discard candidates after the old 150-track cutoff", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test");
    evaluateMock.mockImplementation(async ({ questions }) => ({ answers: Object.fromEntries(Object.keys(questions).map((id) => [id, { type: "boolean", probability: 0.9 }])) }) as never);
    const result = await scoreCandidates(Array.from({ length: 180 }, (_, i) => makeTrack(`track-${i}`)), fallbackPlan(prompt), prompt);
    expect(result.tracks).toHaveLength(180);
    expect(result.jevEvaluated).toBe(180);
  });
});
