import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateJev, hasJevProvider } from "./jev";

const questions = { track_0: { type: "noul" as const, instructions: "Fits?", criteria: { true: "Yes", false: "No" } } };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Jev provider chain", () => {
  it("runs primarily on OpenCode with the free jev-1.13-free model", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "opencode-key");
    vi.stubEnv("TYPESAFE_API_KEY", "typesafe-key");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ answers: { track_0: { type: "noul", noul: 0.9 } } }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await evaluateJev({ state: "state", questions });

    expect(result.provider).toBe("opencode");
    expect(result.model).toBe("jev-1.13-free");
    expect(result.answers.track_0.noul).toBe(0.9);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://opencode.ai/zen/v1/systemone");
    expect(init.headers).toMatchObject({ Authorization: "Bearer opencode-key" });
    expect(JSON.parse(String(init.body))).toEqual({ model: "jev-1.13-free", state: "state", questions });
  });

  it("falls back to the official TypeSafe API when OpenCode fails", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "opencode-key");
    vi.stubEnv("TYPESAFE_API_KEY", "typesafe-key");
    vi.stubEnv("JEV_OFFICIAL_MODEL", "");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ answers: { track_0: { type: "noul", noul: 0.2 } } }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await evaluateJev({ state: "state", questions });

    expect(result.provider).toBe("typesafe");
    expect(result.model).toBe("jev-1.13.0");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.headers).toMatchObject({ Authorization: "Bearer typesafe-key" });
    expect(JSON.parse(String(init.body)).model).toBe("jev-1.13.0");
  });

  it("uses only TypeSafe when OpenCode is not configured", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "");
    vi.stubEnv("TYPESAFE_API_KEY", "typesafe-key");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ answers: {} }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await evaluateJev({ state: "state", questions });

    expect(hasJevProvider()).toBe(true);
    expect(result.provider).toBe("typesafe");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when every configured provider fails", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "opencode-key");
    vi.stubEnv("TYPESAFE_API_KEY", "typesafe-key");
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(evaluateJev({ state: "state", questions })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects when no provider key is configured", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "");
    vi.stubEnv("TYPESAFE_API_KEY", "");
    expect(hasJevProvider()).toBe(false);
    await expect(evaluateJev({ state: "state", questions })).rejects.toThrow(/No Jev provider/);
  });
});
