import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const entryValidator = v.object({
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
});

/** Batch point lookups for enrichment entries (single round trip). */
export const getMany = query({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, { keys }) => {
    const rows = await Promise.all(
      keys.map((key) => ctx.db.query("enrichmentCache").withIndex("by_key", (q) => q.eq("key", key)).unique()),
    );
    return rows.filter((row): row is NonNullable<typeof row> => row !== null).map(({ _id, _creationTime, ...entry }) => entry);
  },
});

/** Upsert enrichment entries; each entry is fully replaced (last write wins). */
export const putMany = mutation({
  args: { entries: v.array(entryValidator) },
  handler: async (ctx, { entries }) => {
    for (const entry of entries) {
      const existing = await ctx.db.query("enrichmentCache").withIndex("by_key", (q) => q.eq("key", entry.key)).unique();
      if (existing) await ctx.db.replace(existing._id, entry);
      else await ctx.db.insert("enrichmentCache", entry);
    }
    return entries.length;
  },
});
