import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db.query("mixes").withIndex("by_user_created", (q) => q.eq("userId", userId)).order("desc").take(60);
    return rows.map(({ _id, _creationTime, publicId, ...mix }) => ({ ...mix, id: publicId }));
  },
});

export const getByPublicId = query({
  args: { id: v.string(), userId: v.string() },
  handler: async (ctx, { id, userId }) => {
    const row = await ctx.db.query("mixes").withIndex("by_public_id", (q) => q.eq("publicId", id)).unique();
    if (!row || row.userId !== userId) return null;
    const { _id, _creationTime, publicId, ...mix } = row;
    return { ...mix, id: publicId };
  },
});

export const upsert = mutation({
  args: { mix: v.any() },
  handler: async (ctx, { mix }) => {
    const existing = await ctx.db.query("mixes").withIndex("by_public_id", (q) => q.eq("publicId", mix.id)).unique();
    const { id, ...record } = mix;
    if (existing) { await ctx.db.patch(existing._id, record); return existing._id; }
    return ctx.db.insert("mixes", { publicId: id, ...record });
  },
});
