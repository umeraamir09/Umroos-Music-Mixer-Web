import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireServiceSecret } from "./access";

export const get = query({
  args: { spotifyUserId: v.string(), serviceSecret: v.string() },
  handler: async (ctx, { spotifyUserId, serviceSecret }) => {
    requireServiceSecret(serviceSecret);
    const row = await ctx.db.query("profiles").withIndex("by_spotify_user", (q) => q.eq("spotifyUserId", spotifyUserId)).unique();
    if (!row) return null;
    const { _id, _creationTime, ...profile } = row;
    return profile;
  },
});

export const upsert = mutation({
  args: {
    serviceSecret: v.string(),
    profile: v.object({
      spotifyUserId: v.string(),
      displayName: v.string(),
      imageUrl: v.optional(v.string()),
      country: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { profile, serviceSecret }) => {
    requireServiceSecret(serviceSecret);
    if (!profile.spotifyUserId) throw new Error("Missing Spotify user ID");
    const existing = await ctx.db.query("profiles").withIndex("by_spotify_user", (q) => q.eq("spotifyUserId", profile.spotifyUserId)).unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { ...profile, updatedAt: now });
      return existing._id;
    }
    return ctx.db.insert("profiles", { ...profile, createdAt: now, updatedAt: now });
  },
});
