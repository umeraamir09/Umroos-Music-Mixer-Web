import { NextRequest, NextResponse } from "next/server";
import { normalizeCustomCover } from "@/lib/cover";
import { saveMix } from "@/lib/history";
import { getSpotifySession, SESSION_COOKIE, seal, secureCookieOptions } from "@/lib/session";
import { refreshSpotifySession, updateSpotifyPlaylistCover } from "@/lib/spotify";
import type { MixRecord } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { mix, coverDataUrl } = await request.json() as { mix: MixRecord; coverDataUrl: string };
    if (!mix?.id || !Array.isArray(mix.tracks) || typeof coverDataUrl !== "string" || coverDataUrl.length > 8_000_000) {
      return NextResponse.json({ error: "Invalid playlist art." }, { status: 400 });
    }
    const current = await getSpotifySession();
    const userId = current?.user.accountId || current?.user.id || "demo";
    const canPersist = mix.userId === userId || mix.userId === "demo";
    if (mix.spotifyId && !canPersist) {
      return NextResponse.json({ error: "This mix belongs to another account." }, { status: 403 });
    }
    const jpeg = await normalizeCustomCover(coverDataUrl);
    const updated = { ...mix, coverDataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}` };
    let session = current;
    if (mix.spotifyId) {
      if (!current) return NextResponse.json({ error: "Connect Spotify to update this playlist cover." }, { status: 401 });
      session = await refreshSpotifySession(current);
      await updateSpotifyPlaylistCover(session, mix.spotifyId, jpeg);
    }
    if (canPersist) await saveMix(updated).catch(() => null);
    const response = NextResponse.json({ mix: updated });
    if (current && session && session.accessToken !== current.accessToken) {
      response.cookies.set(SESSION_COOKIE, seal(session), { ...secureCookieOptions, maxAge: 60 * 60 * 24 * 30 });
    }
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not set playlist art." }, { status: 500 });
  }
}
