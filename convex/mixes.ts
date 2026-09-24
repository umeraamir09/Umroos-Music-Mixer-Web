import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireServiceSecret } from "./access";

export const list = query({
  args: { userId: v.string(), serviceSecret: v.string() },
  handler: async (ctx, { userId, serviceSecret }) => {
    requireServiceSecret(serviceSecret);
    const rows = await ctx.db.query("mixes").withIndex("by_user_created", (q) => q.eq("userId", userId)).order("desc").take(60);
    return rows.map(({ _id, _creationTime, publicId, ...mix }) => ({ ...mix, id: publicId }));
  },
});

export const getByPublicId = query({
  args: { id: v.string(), userId: v.string(), serviceSecret: v.string() },
  handler: async (ctx, { id, userId, serviceSecret }) => {
    requireServiceSecret(serviceSecret);
    const row = await ctx.db.query("mixes").withIndex("by_user_public_id", (q) => q.eq("userId", userId).eq("publicId", id)).unique();
    if (!row) return null;
    const { _id, _creationTime, publicId, ...mix } = row;
    return { ...mix, id: publicId };
  },
});

export const upsert = mutation({
  args: { mix: v.any(), userId: v.string(), serviceSecret: v.string() },
  handler: async (ctx, { mix, userId, serviceSecret }) => {
    requireServiceSecret(serviceSecret);
    if (!mix || typeof mix.id !== "string" || !mix.id || mix.userId !== userId) throw new Error("Invalid mix owner");
    const existing = await ctx.db.query("mixes").withIndex("by_user_public_id", (q) => q.eq("userId", userId).eq("publicId", mix.id)).unique();
    const { id, ...record } = mix;
    if (existing) { await ctx.db.patch(existing._id, record); return existing._id; }
    return ctx.db.insert("mixes", { publicId: id, ...record });
  },
});
