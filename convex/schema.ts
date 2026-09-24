import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  profiles: defineTable({
    spotifyUserId: v.string(),
    displayName: v.string(),
    imageUrl: v.optional(v.string()),
    country: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_spotify_user", ["spotifyUserId"]),
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
  }).index("by_user_created", ["userId", "createdAt"]).index("by_user_public_id", ["userId", "publicId"]),
  // Durable enrichment cache: MusicBrainz allows one request per second, so
  // every track's mbid/genres/tags/features are resolved once and reused.
  // Keys: "sp:{spotifyId}", "ref:{artist}::{title}", "tag:{name}".
  enrichmentCache: defineTable({
    key: v.string(),
    isrc: v.optional(v.string()),
    mbid: v.optional(v.string()),
    genres: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    summary: v.optional(v.string()),
    features: v.optional(v.any()),
    similar: v.optional(v.array(v.object({ title: v.string(), artist: v.string(), match: v.number() }))),
    tried: v.optional(v.object({ lastfm: v.optional(v.boolean()), lastfmMbid: v.optional(v.boolean()), musicbrainz: v.optional(v.boolean()) })),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
  demoQuotas: defineTable({
    bucket: v.string(),
    count: v.number(),
  }).index("by_bucket", ["bucket"]),
  accessRequests: defineTable({
    email: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_email", ["email"]),
});
