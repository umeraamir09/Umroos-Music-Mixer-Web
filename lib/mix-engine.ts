import { createCover } from "@/lib/cover";
import { demoCatalog } from "@/lib/demo-catalog";
import { createMixPlan } from "@/lib/planner";
import { chooseTracks, scoreCandidates } from "@/lib/selector";
import { getTasteCandidates } from "@/lib/spotify";
import type { MixRecord, SpotifySession } from "@/lib/types";
import { stableId } from "@/lib/utils";

export async function generateMix(prompt: string, session: SpotifySession | null): Promise<MixRecord> {
  const { plan } = await createMixPlan(prompt);
  const candidates = session ? await getTasteCandidates(session, plan) : demoCatalog;
  if (candidates.length < 15) throw new Error("Spotify returned too few available tracks for this request. Try a slightly broader prompt.");
  const { tracks: scored, jevEvaluated } = await scoreCandidates(candidates, plan, prompt);
  const tracks = chooseTracks(scored, plan, prompt);
  const cover = await createCover(plan);
  const familiar = tracks.filter((track) => track.familiar).length;
  return {
    id: stableId(),
    userId: session?.user.accountId || session?.user.id || "demo",
    prompt,
    name: plan.name,
    description: plan.description,
    coverPrompt: plan.coverPrompt,
    coverDataUrl: cover.dataUrl,
    tracks,
    targetCount: plan.targetCount,
    status: "draft",
    createdAt: Date.now(),
    stats: { familiar, discoveries: tracks.length - familiar, jevEvaluated },
  };
}
