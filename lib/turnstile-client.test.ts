import { afterEach, describe, expect, it, vi } from "vitest";
import { getTurnstileToken } from "./turnstile-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("demo Turnstile step", () => {
  it("waits for a successful challenge and renders it in the supplied host", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    let onSuccess: ((token: string) => void) | undefined;
    const render = vi.fn((_host, options: { callback: (token: string) => void }) => {
      onSuccess = options.callback;
      return "widget-1";
    });
    const execute = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal("window", { turnstile: { render, execute, remove } });

    const host = {} as HTMLElement;
    let completed = false;
    const token = getTurnstileToken("demo_generate", { container: host });
    void token.then(() => { completed = true; });
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());

    expect(render.mock.calls[0][0]).toBe(host);
    expect(render.mock.calls[0][1]).toMatchObject({ action: "demo_generate", appearance: "always" });
    expect(execute).toHaveBeenCalledWith("widget-1");
    expect(completed).toBe(false);

    onSuccess?.("verified-token");
    await expect(token).resolves.toBe("verified-token");
    expect(remove).toHaveBeenCalledWith("widget-1");
  });

  it("cleans up a cancelled challenge without returning a token", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    const remove = vi.fn();
    const render = vi.fn(() => "widget-2");
    vi.stubGlobal("window", { turnstile: { render, execute: vi.fn(), remove } });

    const controller = new AbortController();
    const token = getTurnstileToken("demo_generate", { container: {} as HTMLElement, signal: controller.signal });
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    controller.abort();

    await expect(token).rejects.toMatchObject({ name: "AbortError" });
    expect(remove).toHaveBeenCalledWith("widget-2");
  });
});
