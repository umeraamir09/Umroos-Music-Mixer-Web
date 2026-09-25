import type { MixRecord } from "@/lib/types";

function cell(value: string | number) {
  let text = String(value);
  // Spreadsheet software treats these prefixes as formulas even in quoted CSV cells.
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function exportMixCsv(mix: MixRecord) {
  const rows = [
    ["Position", "Title", "Artists", "Album", "Duration (ms)", "Spotify URL"],
    ...mix.tracks.map((track, index) => [index + 1, track.name, track.artists.join(", "), track.album, track.durationMs, track.spotifyUrl || ""]),
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  const slug = mix.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "demo-mix";
  link.href = url;
  link.download = `${slug}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
