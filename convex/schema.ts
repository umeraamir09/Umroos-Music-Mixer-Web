import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  mixes: defineTable({
    publicId: v.string(),
    userId: v.string(),
    prompt: v.string(),
    name: v.string(),
    description: v.string(),
    coverPrompt: v.string(),
    coverDataUrl: v.optional(v.string()),
    tracks: v.array(v.any()),
    targetCount: v.number(),
    status: v.union(v.literal("draft"), v.literal("saved"), v.literal("save_failed")),
    spotifyUrl: v.optional(v.string()),
    spotifyId: v.optional(v.string()),
    createdAt: v.number(),
    stats: v.object({ familiar: v.number(), discoveries: v.number(), jevEvaluated: v.number() }),
  }).index("by_user_created", ["userId", "createdAt"]).index("by_public_id", ["publicId"]),
});
