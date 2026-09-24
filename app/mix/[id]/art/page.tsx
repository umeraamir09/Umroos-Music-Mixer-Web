"use client";

import dynamic from "next/dynamic";

const PlaylistArtEditor = dynamic(() => import("@/components/playlist-art-editor"), {
  ssr: false,
  loading: () => <main className="art-loading" role="status">Opening your art studio…</main>,
});

export default function PlaylistArtPage() {
  return <PlaylistArtEditor />;
}
