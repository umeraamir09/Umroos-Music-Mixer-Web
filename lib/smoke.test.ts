import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMixPlan } from "@/lib/planner";
import { evaluateJev, hasJevProvider } from "@/lib/jev";
import { enrichCandidates } from "@/lib/enrich";
import { batchAudioFeatures, recommend, searchTracks } from "@/lib/enrich/reccobeats";
import { lookupIsrc, recordingTags } from "@/lib/enrich/musicbrainz";
import { generateMix } from "@/lib/mix-engine";
import { fallbackPlan } from "@/lib/prompt-plan";
import type { MixTrack } from "@/lib/types";

// Vitest does not load .env files itself; mirror the Next.js dev runtime.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const timed = async <T>(label: string, run: () => Promise<T>): Promise<T> => {
  const start = Date.now();
  try {
    return await run();
  } finally {
    console.log(`[smoke] ${label}: ${Date.now() - start}ms`);
  }
};

async function expectOk(response: Response, label: string) {
  if (!response.ok) throw new Error(`${label} -> HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
}

describe.skipIf(!process.env.LIVE_SMOKE)("live provider smoke (LIVE_SMOKE=1)", () => {
  it("env file provides every key the smoke suite needs", () => {
    const missing = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "GROQ_API_KEY", "OPENCODE_API_KEY", "TYPESAFE_API_KEY", "LASTFM_API_KEY"].filter((key) => !process.env[key]);
    expect(missing).toEqual([]);
    expect(hasJevProvider()).toBe(true);
  }, 10_000);

  it("ReccoBeats answers the real client: batched features, recommendations, search", async () => {
    // Goes through the client (not a raw fetch) so the limiter, the circuit,
    // and the response parsing are all the code paths production uses.
    const features = await timed("reccobeats batchAudioFeatures", () => batchAudioFeatures(["00aqkszH1FdUiJJWvX6iEl"]));
    const entry = features.get("00aqkszH1FdUiJJWvX6iEl");
    expect(entry, JSON.stringify(entry)).toBeDefined();
    expect(typeof entry?.isrc).toBe("string");
    expect(Number.isFinite(entry?.energy)).toBe(true);
    expect(Number.isFinite(entry?.tempo)).toBe(true);
    console.log("[smoke] reccobeats features:", JSON.stringify({ isrc: entry?.isrc, energy: entry?.energy, tempo: entry?.tempo }));

    const seeded = await timed("reccobeats recommend", () => recommend(["00aqkszH1FdUiJJWvX6iEl"], 5));
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded[0].spotifyId).toMatch(/^[A-Za-z0-9]{22}$/);
    expect(seeded[0].artists.length).toBeGreaterThan(0);

    const found = await timed("reccobeats search", () => searchTracks("Blinding Lights"));
    expect(found.length, "ReccoBeats catalog search returned nothing").toBeGreaterThan(0);
    expect(found.every((track) => /^[A-Za-z0-9]{22}$/.test(track.spotifyId) && track.title.length > 0)).toBe(true);
    console.log("[smoke] reccobeats recommend/search:", JSON.stringify({ seeded: seeded.length, found: found.length, top: found[0]?.title }));
  }, 60_000);

  it("Last.fm answers read-only track methods with the shared key", async () => {
    expect(process.env.LASTFM_API_KEY).toBeTruthy();
    const url = new URL("https://ws.audioscrobbler.com/2.0/");
    url.search = new URLSearchParams({
      method: "track.getTopTags",
      artist: "Cher",
      track: "Believe",
      autocorrect: "1",
      api_key: process.env.LASTFM_API_KEY!,
      format: "json",
    }).toString();
    const response = await timed("lastfm getTopTags", () => fetch(url.toString(), { signal: AbortSignal.timeout(15_000) }));
    await expectOk(response, "lastfm getTopTags");
    const data = await response.json();
    expect(Array.isArray(data.toptags?.tag)).toBe(true);
    expect(data.toptags.tag.length).toBeGreaterThan(0);
    console.log("[smoke] lastfm tags:", JSON.stringify(data.toptags.tag.slice(0, 5).map((tag: { name: string }) => tag.name)));
  }, 20_000);

  it("MusicBrainz resolves an ISRC and genres through the paced client", async () => {
    // Everything MusicBrainz goes through one shared queue, so the smoke suite
    // must use it too: raw fetches with an ad-hoc sleep sit outside that queue
    // and, next to a running dev server, are how the 1/s limit gets exceeded.
    // Note the limit is per IP across processes: if this assertion reports a
    // sub-second gap, `next dev` generating a mix at the same time is the other
    // half of the traffic — the failing gap is the tell.
    const stamps: number[] = [];
    const original = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
      stamps.push(Date.now());
      return original.call(globalThis, input, init);
    }) as typeof fetch);

    // USUM72104140 = The Weeknd — Wicked Games; verified present in MusicBrainz.
    const mbid = await timed("musicbrainz lookupIsrc", () => lookupIsrc("USUM72104140"));
    expect(mbid, "ISRC lookup returned no recording").toMatch(/^[0-9a-f-]{36}$/);
    const tags = await timed("musicbrainz recordingTags", () => recordingTags(mbid!));

    expect(stamps.length).toBeGreaterThanOrEqual(2);
    const gaps = stamps.slice(1).map((at, index) => at - stamps[index]);
    for (const gap of gaps) {
      expect(gap, `MusicBrainz requests only ${gap}ms apart (limit is 1000ms)`).toBeGreaterThanOrEqual(1000);
    }
    expect(Array.isArray(tags.genres)).toBe(true);
    console.log("[smoke] musicbrainz:", JSON.stringify({ mbid, gaps, genres: tags.genres.map((genre) => genre.name).slice(0, 5) }));
  }, 60_000);

  it("orchestrator enriches a real track through all three live providers", async () => {
    const plan = fallbackPlan("A soft indie mix like yel's song GHOST");
    // The id MUST be a real Spotify id: ReccoBeats resolves features by
    // Spotify id, and unknown ids (placeholder strings like "live-smoke-track",
    // demo ids, URIs) come back as an empty `content`, so Tier 1 can never
    // land and the assertions below report a provider outage that is really
    // bad input. Same track the other live smokes resolve.
    const track: MixTrack = { id: "00aqkszH1FdUiJJWvX6iEl", name: "Wicked Games", artists: ["The Weeknd"], album: "", durationMs: 180_000, source: "search", familiar: false };
    const outcome = await timed("enrichCandidates live", () => enrichCandidates([track], plan));
    const enriched = outcome.candidates[0];
    // Fresh or cached, every tier must land: features, tags/summary, identity.
    expect(typeof enriched.valence).toBe("number");
    expect(enriched.isrc).toBeTruthy();
    expect(enriched.tags?.length).toBeGreaterThan(0);
    expect(enriched.tagSummary).toBeTruthy();
    expect(enriched.mbid).toMatch(/^[0-9a-f-]{36}$/);
    expect(enriched.genres?.length).toBeGreaterThan(0);
    expect(Object.keys(outcome.tagDefinitions).length).toBeGreaterThan(0);
    console.log("[smoke] enrich:", JSON.stringify({
      isrc: enriched.isrc,
      valence: enriched.valence,
      genres: enriched.genres,
      tags: enriched.tags,
      stats: outcome.stats,
    }));
  }, 60_000);

  it("Cloudflare chat completions answers @cf/zai-org/glm-4.7-flash (raw endpoint)", async () => {
    const response = await timed("cloudflare raw chat", () =>
      fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
          "cf-aig-gateway-id": process.env.CLOUDFLARE_AI_GATEWAY_ID || "default",
        },
        body: JSON.stringify({ model: "@cf/zai-org/glm-4.7-flash", messages: [{ role: "user", content: "Reply with exactly: OK" }] }),
        signal: AbortSignal.timeout(40_000),
      }),
    );
    await expectOk(response, "cloudflare raw chat");
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    expect(typeof content).toBe("string");
    console.log("[smoke] cloudflare replied:", JSON.stringify(content).slice(0, 120));
  }, 45_000);

  it("Groq chat completions answers openai/gpt-oss-120b (raw endpoint)", async () => {
    const response = await timed("groq raw chat", () =>
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          messages: [{ role: "user", content: "Reply with exactly: OK" }],
          reasoning_effort: "low",
          max_completion_tokens: 1500,
        }),
        signal: AbortSignal.timeout(40_000),
      }),
    );
    await expectOk(response, "groq raw chat");
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    expect(typeof content).toBe("string");
    console.log("[smoke] groq replied:", JSON.stringify(content).slice(0, 120));
  }, 45_000);

  it("planner produces a schema-shaped plan via Cloudflare without falling back", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { plan, usedAi } = await timed("planner via cloudflare", () => createMixPlan("A dreamy late-night indie mix with a few familiar favorites"));
    // Surface captured provider warnings if the plan did not come back.
    expect(usedAi, JSON.stringify(warn.mock.calls)).toBe(true);
    // Any provider failure logs a warning; none means Cloudflare served it.
    expect(warn.mock.calls).toEqual([]);
    expect(plan.name.length).toBeGreaterThan(0);
    expect(plan.targetCount).toBeGreaterThanOrEqual(15);
    expect(plan.searchQueries.length).toBeGreaterThan(0);
    expect(Array.isArray(plan.allowedArtists)).toBe(true);
    console.log("[smoke] plan:", JSON.stringify({ name: plan.name, targetCount: plan.targetCount, energy: plan.energy, queries: plan.searchQueries.length }));
  }, 45_000);

  it("planner falls back to Groq when Cloudflare credentials are hidden", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { plan, usedAi } = await timed("planner via groq", () => createMixPlan("A sunny funk playlist for cooking"));
    expect(usedAi, JSON.stringify(warn.mock.calls)).toBe(true);
    expect(warn.mock.calls).toEqual([]);
    expect(plan.targetCount).toBeGreaterThanOrEqual(15);
    console.log("[smoke] groq plan:", JSON.stringify({ name: plan.name, targetCount: plan.targetCount }));
  }, 45_000);

  it("planner degrades to local heuristics when every provider rejects", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
    vi.stubEnv("GROQ_API_KEY", "invalid-key-for-smoke");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { usedAi } = await timed("planner all-fail", () => createMixPlan("house music only"));
    expect(usedAi).toBe(false);
    const messages = warn.mock.calls.flat().map(String).join(" ");
    expect(messages).toContain("Planning via groq");
    expect(messages).toContain("all providers failed");
  }, 45_000);

  it("Jev runs primarily on OpenCode with the free model", async () => {
    const questions = { fits: { type: "noul" as const, instructions: "Is this request about house music?", criteria: { true: "House music", false: "Not house" } } };
    const result = await timed("jev via opencode", () => evaluateJev({ state: "I want a loud house music party playlist.", questions }));
    expect(result.provider).toBe("opencode");
    expect(result.model).toMatch(/jev/);
    expect(result.answers.fits.type).toBe("noul");
    expect(result.answers.fits.noul).toBeGreaterThanOrEqual(0.6);
    console.log("[smoke] jev opencode:", JSON.stringify({ provider: result.provider, model: result.model, noul: result.answers.fits.noul }));
  }, 30_000);

  it("Jev falls back to the official TypeSafe API when OpenCode is hidden", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "");
    const questions = { fits: { type: "noul" as const, instructions: "Is this request about house music?", criteria: { true: "House music", false: "Not house" } } };
    const result = await timed("jev via typesafe", () => evaluateJev({ state: "I want a loud house music party playlist.", questions }));
    expect(result.provider).toBe("typesafe");
    expect(result.answers.fits.type).toBe("noul");
    expect(result.answers.fits.noul).toBeGreaterThanOrEqual(0.6);
    console.log("[smoke] jev typesafe:", JSON.stringify({ provider: result.provider, model: result.model, noul: result.answers.fits.noul }));
  }, 30_000);

  it("Jev rejects after both providers refuse invalid keys", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "invalid-key-for-smoke");
    vi.stubEnv("TYPESAFE_API_KEY", "invalid-key-for-smoke");
    await expect(evaluateJev({ state: "x", questions: { q: { type: "noul" as const, instructions: "true?" } } })).rejects.toThrow();
  }, 30_000);

  it("full pipeline mixes with live planning, live Jev, and a live Cloudflare cover", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mix = await timed("generateMix end-to-end", () => generateMix("A dreamy late night indie mix with soft familiar songs", null));
    // No fallback anywhere: planner, Jev batches, and cover all served live.
    expect(warn.mock.calls).toEqual([]);
    expect(mix.tracks.length).toBeGreaterThan(0);
    expect(mix.stats.jevEvaluated).toBeGreaterThan(0);
    expect(mix.coverDataUrl?.startsWith("data:image/jpeg")).toBe(true);
    expect(mix.name.length).toBeGreaterThan(0);
    expect(mix.description.length).toBeGreaterThan(0);
    console.log("[smoke] mix:", JSON.stringify({ name: mix.name, tracks: mix.tracks.length, target: mix.targetCount, jevEvaluated: mix.stats.jevEvaluated, coverKb: Math.round((mix.coverDataUrl?.length ?? 0) / 1024) }));
  }, 120_000);
});
