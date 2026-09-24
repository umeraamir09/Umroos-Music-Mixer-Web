import { makeFunctionReference } from "convex/server";
import { convexService } from "@/lib/convex-service";
import type { MixRecord } from "@/lib/types";

const listRef = makeFunctionReference<"query", { userId: string; serviceSecret: string }, MixRecord[]>("mixes:list");
const getRef = makeFunctionReference<"query", { id: string; userId: string; serviceSecret: string }, MixRecord | null>("mixes:getByPublicId");
const upsertRef = makeFunctionReference<"mutation", { mix: MixRecord; userId: string; serviceSecret: string }, string>("mixes:upsert");

export async function listMixes(userId: string) {
  const service = convexService();
  return service ? service.client.query(listRef, { userId, serviceSecret: service.serviceSecret }) : [];
}

export async function getMix(id: string, userId: string) {
  const service = convexService();
  return service ? service.client.query(getRef, { id, userId, serviceSecret: service.serviceSecret }) : null;
}

export async function saveMix(userId: string, mix: MixRecord) {
  if (mix.userId !== userId) throw new Error("Mix owner does not match the current account");
  const service = convexService();
  if (!service) return null;
  return service.client.mutation(upsertRef, { mix, userId, serviceSecret: service.serviceSecret });
}
