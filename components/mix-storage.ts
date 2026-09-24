import type { MixRecord, PublicSession } from "@/lib/types";

const LEGACY_KEY = "umm_mix_history_v1";
const keyFor = (userId: string) => `umm_mix_history_v2:${userId}`;

function load(key: string): MixRecord[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

export function publicUserId(session: PublicSession): string {
  return session.authenticated ? session.user?.accountId || session.user?.id || "demo" : "demo";
}

export function readLocalMixes(userId: string): MixRecord[] {
  if (typeof window === "undefined") return [];
  const rows = [...load(LEGACY_KEY), ...load(keyFor(userId))];
  return [...new Map(rows.filter((mix) => mix && mix.userId === userId && typeof mix.id === "string").map((mix) => [mix.id, mix])).values()];
}

export function storeLocalMix(mix: MixRecord) {
  const key = keyFor(mix.userId);
  const next = [mix, ...readLocalMixes(mix.userId).filter((item) => item.id !== mix.id)].slice(0, 40);
  try { localStorage.setItem(key, JSON.stringify(next)); } catch {
    // Covers can exhaust storage; retain compact metadata if that happens.
    localStorage.setItem(key, JSON.stringify(next.map((item, index) => index < 4 ? item : { ...item, coverDataUrl: undefined })));
  }
}

export function readLocalMix(id: string, userId: string) {
  return readLocalMixes(userId).find((mix) => mix.id === id) || null;
}
