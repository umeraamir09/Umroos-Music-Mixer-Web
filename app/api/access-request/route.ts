import { NextRequest, NextResponse } from "next/server";
import { requestSpotifyAccess, verifyTurnstile } from "@/lib/portfolio";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { email?: unknown; turnstileToken?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    if (!await verifyTurnstile(body.turnstileToken, "access_request")) {
      return NextResponse.json({ error: "Human verification failed. Please retry." }, { status: 403 });
    }
    const result = await requestSpotifyAccess(email);
    if (!result.accepted) return NextResponse.json({ error: "Access requests are full today. Please try again tomorrow." }, { status: 429 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Access request failed:", error);
    return NextResponse.json({ error: "Could not save your request. Please try later." }, { status: 503 });
  }
}
