import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { OAUTH_COOKIE, seal, secureCookieOptions } from "@/lib/session";

export async function GET() {
  if (!process.env.SPOTIFY_CLIENT_ID) return NextResponse.redirect(new URL("/?error=spotify_config", process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000"));
  const state = randomBytes(24).toString("base64url");
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI || "http://127.0.0.1:3000/api/auth/callback";
  const scopes = ["user-read-private", "user-read-email", "user-top-read", "user-read-recently-played", "user-library-read", "playlist-modify-private", "ugc-image-upload"].join(" ");
  const url = new URL("https://accounts.spotify.com/authorize");
  url.search = new URLSearchParams({ client_id: process.env.SPOTIFY_CLIENT_ID, response_type: "code", redirect_uri: redirectUri, state, scope: scopes, show_dialog: "false" }).toString();
  const response = NextResponse.redirect(url);
  response.cookies.set(OAUTH_COOKIE, seal({ state }), { ...secureCookieOptions, maxAge: 600 });
  return response;
}
