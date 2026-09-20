import { NextResponse } from "next/server";
import { getSpotifySession } from "@/lib/session";

export async function GET() {
  const session = await getSpotifySession();
  if (session) return NextResponse.json({ authenticated: true, demo: false, user: session.user });
  return NextResponse.json({ authenticated: false, demo: process.env.NEXT_PUBLIC_DEMO_MODE !== "false", user: { id: "demo", displayName: "U" } });
}
