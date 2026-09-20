import type { MixRecord } from "@/lib/types";

const KEY = "umm_mix_history_v1";

export function readLocalMixes(): MixRecord[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEY) || "[]") as MixRecord[]; } catch { return []; }
}

export function storeLocalMix(mix: MixRecord) {
  const next = [mix, ...readLocalMixes().filter((item) => item.id !== mix.id)].slice(0, 40);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {
    // Covers can exhaust storage; retain compact metadata if that happens.
    localStorage.setItem(KEY, JSON.stringify(next.map((item, index) => index < 4 ? item : { ...item, coverDataUrl: undefined })));
  }
}

export function readLocalMix(id: string) {
  return readLocalMixes().find((mix) => mix.id === id) || null;
}
