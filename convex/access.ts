declare const process: { env: Record<string, string | undefined> };

/** Only the Next.js server may call these public Convex functions. */
export function requireServiceSecret(provided: string) {
  const expected = process.env.CONVEX_SERVICE_SECRET;
  if (!expected || expected.length < 32 || provided !== expected) {
    throw new Error("Unauthorized Convex request");
  }
}
