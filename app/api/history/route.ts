import { NextRequest, NextResponse } from "next/server";
import { listMixes, saveMix } from "@/lib/history";
import { getSpotifySession } from "@/lib/session";
import type { MixRecord } from "@/lib/types";

export async function GET() {
  const session = await getSpotifySession();
  const userId = session?.user.accountId || session?.user.id || "demo";
  return NextResponse.json({ mixes: await listMixes(userId) });
}

export async function POST(request: NextRequest) {
  const session = await getSpotifySession();
  const mix = await request.json() as MixRecord;
  const userId = session?.user.accountId || session?.user.id || "demo";
  if (!mix?.id || mix.userId !== userId) return NextResponse.json({ error: "Invalid mix." }, { status: 400 });
  await saveMix(mix);
  return NextResponse.json({ ok: true });
}
