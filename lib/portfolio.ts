import { createHmac, randomUUID } from "node:crypto";
import { makeFunctionReference } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { convexService } from "@/lib/convex-service";
import { seal, unseal } from "@/lib/session";

export const VISITOR_COOKIE = "umm_demo_visitor";
const reserveRef = makeFunctionReference<"mutation", { visitor: string; serviceSecret: string }, { allowed: boolean; reason: string; resetAt: number }>("portfolio:reserveDemo");
const accessRef = makeFunctionReference<"mutation", { email: string; serviceSecret: string }, { accepted: boolean; alreadyRequested: boolean; requestId: Id<"accessRequests"> | null; ownerNotified: boolean; requesterNotified: boolean }>("portfolio:requestAccess");
const markAccessEmailSentRef = makeFunctionReference<"mutation", { requestId: Id<"accessRequests">; recipient: "owner" | "requester"; serviceSecret: string }, null>("portfolio:markAccessRequestEmailSent");

export function demoVisitor(value?: string) {
  const stored = unseal<{ id: string }>(value);
  const id = stored && /^[a-f0-9-]{36}$/.test(stored.id) ? stored.id : randomUUID();
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV !== "production") {
    return { id, cookie: undefined, hash: createHmac("sha256", "local-demo-only").update(id).digest("hex") };
  }
  if (!secret) throw new Error("SESSION_SECRET is required for demo limits");
  return { id, cookie: stored ? undefined : seal({ id }), hash: createHmac("sha256", secret).update(id).digest("hex") };
}

export async function reserveDemo(visitorHash: string) {
  const service = convexService();
  if (!service && process.env.NODE_ENV !== "production") return { allowed: true, reason: "", resetAt: Date.now() + 86_400_000 };
  if (!service) throw new Error("Convex is required for public demo limits");
  return service.client.mutation(reserveRef, { visitor: visitorHash, serviceSecret: service.serviceSecret });
}

export async function requestSpotifyAccess(email: string) {
  const service = convexService();
  if (!service) throw new Error("Convex is required for access requests");
  return service.client.mutation(accessRef, { email, serviceSecret: service.serviceSecret });
}

export async function markSpotifyAccessEmailSent(requestId: Id<"accessRequests">, recipient: "owner" | "requester") {
  const service = convexService();
  if (!service) throw new Error("Convex is required for access requests");
  await service.client.mutation(markAccessEmailSentRef, { requestId, recipient, serviceSecret: service.serviceSecret });
}

export async function verifyTurnstile(token: unknown, action: string) {
  const secret = process.env.TURNSTILE_SECRET;
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!secret) return !siteKey && process.env.NODE_ENV !== "production";
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  const expectedHostnames = new Set((process.env.TURNSTILE_HOSTNAMES ?? "").split(",").map((hostname) => hostname.trim()).filter(Boolean));
  if (!expectedHostnames.size) return false;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!response.ok) return false;
    const result = await response.json() as { success?: boolean; action?: string; hostname?: string };
    return result.success === true && result.action === action && expectedHostnames.has(result.hostname ?? "");
  } catch {
    return false;
  }
}
