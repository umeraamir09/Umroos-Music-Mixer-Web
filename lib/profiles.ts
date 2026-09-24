import { makeFunctionReference } from "convex/server";
import { convexService } from "@/lib/convex-service";
import type { SpotifySession } from "@/lib/types";

export type ListenerProfile = SpotifySession["user"];

const upsertRef = makeFunctionReference<"mutation", {
  profile: { spotifyUserId: string; displayName: string; imageUrl?: string; country?: string };
  serviceSecret: string;
}, string>("profiles:upsert");

export async function saveProfile(user: ListenerProfile) {
  const service = convexService();
  if (!service) return null;
  return service.client.mutation(upsertRef, {
    profile: {
      spotifyUserId: user.accountId || user.id,
      displayName: user.displayName,
      imageUrl: user.imageUrl,
      country: user.country,
    },
    serviceSecret: service.serviceSecret,
  });
}
