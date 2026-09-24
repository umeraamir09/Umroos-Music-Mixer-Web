import { ConvexHttpClient } from "convex/browser";

/** Convex is accessed only from server routes, never with a browser credential. */
export function convexService() {
  const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  const serviceSecret = process.env.CONVEX_SERVICE_SECRET;
  if (!serviceSecret || serviceSecret.length < 32) {
    throw new Error("CONVEX_SERVICE_SECRET must be at least 32 characters in Next.js and Convex");
  }
  return { client: new ConvexHttpClient(url), serviceSecret };
}
