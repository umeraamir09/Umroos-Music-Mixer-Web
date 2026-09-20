export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item).toLocaleLowerCase();
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function formatDuration(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function compactText(value: string, max = 120) {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function stableId(prefix = "mix") {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}
