import { NextRequest, NextResponse } from "next/server";
import { generateMix } from "@/lib/mix-engine";
import { saveMix } from "@/lib/history";
import { getSpotifySession, SESSION_COOKIE, seal, secureCookieOptions } from "@/lib/session";
import { refreshSpotifySession } from "@/lib/spotify";

export const runtime = "nodejs";
// The selector has a bounded work budget and starts cover art in parallel.
export const maxDuration = 150;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const prompt = String(body.prompt || "").replace(/\s+/g, " ").trim();
    if (prompt.length < 3 || prompt.length > 1200) return NextResponse.json({ error: "Describe your mix in 3–1,200 characters." }, { status: 400 });
    let session = await getSpotifySession();
    let refreshed = false;
    if (session) {
      const next = await refreshSpotifySession(session);
      refreshed = next.accessToken !== session.accessToken;
      session = next;
    }
    const mix = await generateMix(prompt, session);
    await saveMix(mix).catch(() => null);
    const response = NextResponse.json({ mix, mode: session ? "spotify" : "demo" });
    if (session && refreshed) response.cookies.set(SESSION_COOKIE, seal(session), { ...secureCookieOptions, maxAge: 60 * 60 * 24 * 30 });
    return response;
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "The mix could not be generated." }, { status: 500 });
  }
}
