import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { SpotifySession } from "@/lib/types";

export const SESSION_COOKIE = "umm_session";
export const OAUTH_COOKIE = "umm_oauth";

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 24) throw new Error("SESSION_SECRET must be at least 24 characters");
  return createHash("sha256").update(secret).digest();
}

export function seal(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function unseal<T>(value?: string): T | null {
  if (!value) return null;
  try {
    const [iv, tag, payload] = value.split(".");
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8")) as T;
  } catch {
    return null;
  }
}

export async function getSpotifySession() {
  const store = await cookies();
  return unseal<SpotifySession>(store.get(SESSION_COOKIE)?.value);
}

export function spotifyUserId(session: SpotifySession) {
  return session.user.accountId || session.user.id;
}

export const secureCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};
