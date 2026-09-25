import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "./portfolio";

describe("Turnstile verification", () => {
  beforeEach(() => {
    vi.stubEnv("TURNSTILE_SECRET", "test-secret");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    vi.stubEnv("TURNSTILE_HOSTNAMES", "musicmixer.umroo.dev");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("posts a form-encoded token to Siteverify and accepts the expected action and hostname", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, action: "access_request", hostname: "musicmixer.umroo.dev" })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyTurnstile("fresh-token", "access_request")).resolves.toBe(true);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(new URLSearchParams(options.body)).toEqual(new URLSearchParams({ secret: "test-secret", response: "fresh-token" }));
  });

  it.each([
    [{ success: false, action: "access_request", hostname: "musicmixer.umroo.dev" }],
    [{ success: true, action: "demo_generate", hostname: "musicmixer.umroo.dev" }],
    [{ success: true, action: "access_request", hostname: "localhost" }],
  ])("rejects a failed or mismatched Siteverify response", async (result) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(result))));
    await expect(verifyTurnstile("token", "access_request")).resolves.toBe(false);
  });

  it("fails closed when the hostname allowlist or secret is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("TURNSTILE_HOSTNAMES", "");
    await expect(verifyTurnstile("token", "access_request")).resolves.toBe(false);
    vi.stubEnv("TURNSTILE_HOSTNAMES", "musicmixer.umroo.dev");
    vi.stubEnv("TURNSTILE_SECRET", "");
    await expect(verifyTurnstile("token", "access_request")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized tokens and Siteverify failures", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyTurnstile("x".repeat(2049), "access_request")).resolves.toBe(false);
    await expect(verifyTurnstile("token", "access_request")).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
