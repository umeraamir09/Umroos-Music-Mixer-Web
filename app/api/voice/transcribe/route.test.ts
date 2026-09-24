import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

function recording(type = "audio/webm") {
  const body = new FormData();
  body.set("audio", new File(["recorded audio"], "voice.webm", { type }));
  return new Request("http://localhost/api/voice/transcribe", { method: "POST", body });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("voice transcription route", () => {
  it("forwards the recording to Groq Whisper Large V3 Turbo and returns the transcript", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    const provider = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.method).toBe("POST");
      expect(new Headers(options.headers).get("Authorization")).toBe("Bearer test-key");
      const body = options.body as FormData;
      expect(body.get("model")).toBe("whisper-large-v3-turbo");
      expect(body.get("response_format")).toBe("json");
      expect((body.get("file") as File).name).toBe("voice-prompt.webm");
      return Response.json({ text: "  A calm jazz mix  " });
    });
    vi.stubGlobal("fetch", provider);

    const response = await POST(recording());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "A calm jazz mix" });
    expect(provider.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
  });

  it("explains a missing key without calling Groq", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    const response = await POST(recording());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("GROQ_API_KEY");
    expect(provider).not.toHaveBeenCalled();
  });

  it("rejects unsupported audio before forwarding it", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    const response = await POST(recording("text/plain"));
    expect(response.status).toBe(415);
    expect(provider).not.toHaveBeenCalled();
  });

  it("shows the Groq rate limit", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "rate limit" } }, { status: 429 })));
    const response = await POST(recording());
    expect(response.status).toBe(429);
    expect((await response.json()).error).toContain("transcription rate limit");
  });
});
