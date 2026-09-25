import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireServiceSecret } from "./access";

const DAILY_VISITOR_LIMIT = 3;
const DAILY_GLOBAL_LIMIT = 20;
const DAILY_ACCESS_REQUEST_LIMIT = 30;

function dayKey(now: number) {
  return new Date(now).toISOString().slice(0, 10);
}

export const reserveDemo = mutation({
  args: { visitor: v.string(), serviceSecret: v.string() },
  handler: async (ctx, { visitor, serviceSecret }) => {
    requireServiceSecret(serviceSecret);
    if (!/^[a-f0-9]{64}$/.test(visitor)) throw new Error("Invalid visitor identity");
    const now = Date.now();
    const day = dayKey(now);
    const keys = [`demo:${day}:global`, `demo:${day}:visitor:${visitor}`];
    const rows = await Promise.all(keys.map((bucket) => ctx.db.query("demoQuotas").withIndex("by_bucket", (q) => q.eq("bucket", bucket)).unique()));
    const resetAt = Date.parse(`${day}T00:00:00.000Z`) + 86_400_000;
    if ((rows[0]?.count ?? 0) >= DAILY_GLOBAL_LIMIT) return { allowed: false, reason: "global", resetAt };
    if ((rows[1]?.count ?? 0) >= DAILY_VISITOR_LIMIT) return { allowed: false, reason: "visitor", resetAt };
    for (let index = 0; index < keys.length; index += 1) {
      const row = rows[index];
      if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
      else await ctx.db.insert("demoQuotas", { bucket: keys[index], count: 1 });
    }
    return { allowed: true, reason: "", resetAt };
  },
});

export const requestAccess = mutation({
  args: { email: v.string(), serviceSecret: v.string() },
  handler: async (ctx, { email, serviceSecret }) => {
    requireServiceSecret(serviceSecret);
    const normalized = email.trim().toLowerCase();
    if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("Enter a valid email address");
    const now = Date.now();
    const existing = await ctx.db.query("accessRequests").withIndex("by_email", (q) => q.eq("email", normalized)).first();
    if (existing) return {
      accepted: true,
      alreadyRequested: true,
      requestId: existing._id,
      ownerNotified: existing.emailSentAt !== undefined,
      requesterNotified: existing.confirmationEmailSentAt !== undefined,
    };
    const bucket = `access:${dayKey(now)}`;
    const quota = await ctx.db.query("demoQuotas").withIndex("by_bucket", (q) => q.eq("bucket", bucket)).unique();
    if ((quota?.count ?? 0) >= DAILY_ACCESS_REQUEST_LIMIT) return { accepted: false, alreadyRequested: false, requestId: null, ownerNotified: false, requesterNotified: false };
    if (quota) await ctx.db.patch(quota._id, { count: quota.count + 1 });
    else await ctx.db.insert("demoQuotas", { bucket, count: 1 });
    const requestId = await ctx.db.insert("accessRequests", { email: normalized, createdAt: now, updatedAt: now });
    return { accepted: true, alreadyRequested: false, requestId, ownerNotified: false, requesterNotified: false };
  },
});

export const markAccessRequestEmailSent = mutation({
  args: { requestId: v.id("accessRequests"), recipient: v.union(v.literal("owner"), v.literal("requester")), serviceSecret: v.string() },
  handler: async (ctx, { requestId, recipient, serviceSecret }) => {
    requireServiceSecret(serviceSecret);
    const request = await ctx.db.get(requestId);
    if (!request) throw new Error("Access request not found");
    if (recipient === "owner" && request.emailSentAt === undefined) await ctx.db.patch(requestId, { emailSentAt: Date.now() });
    if (recipient === "requester" && request.confirmationEmailSentAt === undefined) await ctx.db.patch(requestId, { confirmationEmailSentAt: Date.now() });
  },
});
