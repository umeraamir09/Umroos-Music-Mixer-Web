import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { OAUTH_COOKIE, SESSION_COOKIE, seal, secureCookieOptions, unseal } from "@/lib/session";
import { saveProfile } from "@/lib/profiles";

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const store = await cookies();
  const oauth = unseal<{ state: string }>(store.get(OAUTH_COOKIE)?.value);
  if (!code || !state || !oauth || state !== oauth.state) return NextResponse.redirect(new URL("/?error=oauth_state", appUrl));

  const redirectUri = process.env.SPOTIFY_REDIRECT_URI || `${appUrl}/api/auth/callback`;
  const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    cache: "no-store",
  });
  if (!tokenResponse.ok) return NextResponse.redirect(new URL("/?error=spotify_token", appUrl));
  const token = await tokenResponse.json();
  const profileResponse = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${token.access_token}` }, cache: "no-store" });
  if (!profileResponse.ok) return NextResponse.redirect(new URL("/?error=spotify_profile", appUrl));
  const profile = await profileResponse.json();
  const session = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    scope: token.scope,
    user: { id: profile.id, accountId: profile.account_id, displayName: profile.display_name || "Listener", imageUrl: profile.images?.[0]?.url, country: profile.country },
  };
  await saveProfile(session.user);
  const response = NextResponse.redirect(new URL("/mix", appUrl));
  response.cookies.set(SESSION_COOKIE, seal(session), { ...secureCookieOptions, maxAge: 60 * 60 * 24 * 30 });
  response.cookies.delete(OAUTH_COOKIE);
  return response;
}
