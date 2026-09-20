import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { MixRecord } from "@/lib/types";

function client() {
  const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  return url ? new ConvexHttpClient(url) : null;
}

const listRef = makeFunctionReference<"query", { userId: string }, MixRecord[]>("mixes:list");
const getRef = makeFunctionReference<"query", { id: string; userId: string }, MixRecord | null>("mixes:getByPublicId");
const upsertRef = makeFunctionReference<"mutation", { mix: MixRecord }, string>("mixes:upsert");

export async function listMixes(userId: string) {
  const convex = client();
  return convex ? convex.query(listRef, { userId }) : [];
}

export async function getMix(id: string, userId: string) {
  const convex = client();
  return convex ? convex.query(getRef, { id, userId }) : null;
}

export async function saveMix(mix: MixRecord) {
  const convex = client();
  if (!convex) return null;
  return convex.mutation(upsertRef, { mix });
}
