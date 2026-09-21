import { afterEach, expect, it, vi } from "vitest";
import { generateMix } from "./mix-engine";

vi.mock("@/lib/cover", () => ({ createCover: vi.fn(async () => ({ dataUrl: "data:image/jpeg;base64,test" })) }));
afterEach(() => vi.unstubAllEnvs());

it("generates a shorter Drake-only mix end to end without AI services", async () => {
  vi.stubEnv("DEEPSEEK_BASE_URL", "");
  vi.stubEnv("AI_GATEWAY_API_KEY", "");
  const mix = await generateMix("A Drake only club music playlist.", null);
  expect(mix.tracks.length).toBeGreaterThan(0);
  expect(mix.tracks.length).toBeLessThan(mix.targetCount);
  expect(mix.tracks.every((track) => track.artists.includes("Drake"))).toBe(true);
  expect(mix.stats.discoveries).toBe(0);
});

it("reports no matches instead of padding a restricted request with other artists", async () => {
  vi.stubEnv("DEEPSEEK_BASE_URL", "");
  vi.stubEnv("AI_GATEWAY_API_KEY", "");
  await expect(generateMix("Bad Bunny only", null)).rejects.toThrow("No tracks could be verified as a match");
});
