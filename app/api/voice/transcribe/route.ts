import { NextResponse } from "next/server";
import { getSpotifySession } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const audioFormats: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
};

export async function POST(request: Request) {
  if (!await getSpotifySession()) {
    return NextResponse.json({ error: "Voice prompts are available to invited Spotify users. Type a prompt to try the demo." }, { status: 403 });
  }
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "Voice input needs a Groq API key. Add GROQ_API_KEY to .env.local." }, { status: 503 });
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (contentLength > MAX_AUDIO_BYTES + 1024) {
    return NextResponse.json({ error: "Recording is too large. Try a shorter prompt." }, { status: 413 });
  }

  let audio: FormDataEntryValue | null;
  try {
    audio = (await request.formData()).get("audio");
  } catch {
    return NextResponse.json({ error: "Could not read the recording." }, { status: 400 });
  }

  if (!(audio instanceof File) || !audio.size) {
    return NextResponse.json({ error: "Record a prompt before transcribing it." }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Recording is too large. Try a shorter prompt." }, { status: 413 });
  }

  const format = audioFormats[audio.type.split(";")[0].toLowerCase()];
  if (!format) {
    return NextResponse.json({ error: "This browser's recording format is unsupported. Try another browser." }, { status: 415 });
  }

  const body = new FormData();
  body.set("model", "whisper-large-v3-turbo");
  body.set("response_format", "json");
  body.set("file", audio, `voice-prompt.${format}`);

  try {
    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(55_000)]),
      cache: "no-store",
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const providerMessage = result && typeof result === "object" && "error" in result
        && result.error && typeof result.error === "object" && "message" in result.error
        && typeof result.error.message === "string" ? result.error.message : "";
      const message = response.status === 401 || response.status === 403
        ? "Groq rejected the API key. Check GROQ_API_KEY."
        : response.status === 429
          ? "Groq's transcription rate limit was reached. Try again later."
          : providerMessage || "Voice transcription failed. Try again.";
      return NextResponse.json({ error: message }, { status: response.status === 429 ? 429 : 502 });
    }

    const text = result && typeof result === "object" && "text" in result && typeof result.text === "string"
      ? result.text.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "No speech was detected. Try recording again." }, { status: 422 });
    }
    return NextResponse.json({ text });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "Transcription timed out. Try a shorter recording."
      : "Could not reach Groq. Try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
