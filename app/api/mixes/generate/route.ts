import { NextRequest, NextResponse } from "next/server";
import { generateMix } from "@/lib/mix-engine";
import { saveMix } from "@/lib/history";
import { getSpotifySession, SESSION_COOKIE, seal, secureCookieOptions, spotifyUserId } from "@/lib/session";
import { refreshSpotifySession } from "@/lib/spotify";
import { demoVisitor, reserveDemo, verifyTurnstile, VISITOR_COOKIE } from "@/lib/portfolio";

export const runtime = "nodejs";
// The selector has a bounded work budget and starts cover art in parallel.
export const maxDuration = 150;

export async function POST(request: NextRequest) {
  let visitorCookie: string | undefined;
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
    if (!session) {
      if (process.env.NEXT_PUBLIC_DEMO_MODE === "false") return NextResponse.json({ error: "The demo is unavailable." }, { status: 403 });
      if (!await verifyTurnstile(body.turnstileToken, "demo_generate")) {
        return NextResponse.json({ error: "Human verification failed. Please retry." }, { status: 403 });
      }
      const visitor = demoVisitor(request.cookies.get(VISITOR_COOKIE)?.value);
      visitorCookie = visitor.cookie;
      let quota: Awaited<ReturnType<typeof reserveDemo>>;
      try { quota = await reserveDemo(visitor.hash); }
      catch (error) {
        console.error("Demo quota unavailable:", error);
        return NextResponse.json({ error: "The demo is temporarily unavailable. Please try later." }, { status: 503 });
      }
      if (!quota.allowed) {
        const message = quota.reason === "visitor"
          ? "You have used your 3 demo mixes for today. Come back after the UTC daily reset."
          : "Today's demo capacity is full. Come back after the UTC daily reset.";
        const response = NextResponse.json({ error: message, resetAt: quota.resetAt }, { status: 429 });
        response.headers.set("Retry-After", String(Math.max(1, Math.ceil((quota.resetAt - Date.now()) / 1000))));
        if (visitorCookie) response.cookies.set(VISITOR_COOKIE, visitorCookie, { ...secureCookieOptions, maxAge: 60 * 60 * 24 * 90 });
        return response;
      }
    }
    const mix = await generateMix(prompt, session);
    if (session) await saveMix(spotifyUserId(session), mix);
    const response = NextResponse.json({ mix, mode: session ? "spotify" : "demo" });
    if (session && refreshed) response.cookies.set(SESSION_COOKIE, seal(session), { ...secureCookieOptions, maxAge: 60 * 60 * 24 * 30 });
    if (visitorCookie) response.cookies.set(VISITOR_COOKIE, visitorCookie, { ...secureCookieOptions, maxAge: 60 * 60 * 24 * 90 });
    return response;
  } catch (error) {
    console.error(error);
    const response = NextResponse.json({ error: error instanceof Error ? error.message : "The mix could not be generated." }, { status: 500 });
    if (visitorCookie) response.cookies.set(VISITOR_COOKIE, visitorCookie, { ...secureCookieOptions, maxAge: 60 * 60 * 24 * 90 });
    return response;
  }
}
