import { NextRequest, NextResponse } from "next/server";
import { listMixes, saveMix } from "@/lib/history";
import { getSpotifySession, spotifyUserId } from "@/lib/session";
import type { MixRecord } from "@/lib/types";

export async function GET() {
  const session = await getSpotifySession();
  if (!session) return NextResponse.json({ mixes: [] });
  return NextResponse.json({ mixes: await listMixes(spotifyUserId(session)) });
}

export async function POST(request: NextRequest) {
  const session = await getSpotifySession();
  if (!session) return NextResponse.json({ error: "Connect Spotify to save mix history." }, { status: 401 });
  const mix = await request.json() as MixRecord;
  const userId = spotifyUserId(session);
  if (!mix?.id || mix.userId !== userId) return NextResponse.json({ error: "Invalid mix." }, { status: 400 });
  await saveMix(userId, mix);
  return NextResponse.json({ ok: true });
}
