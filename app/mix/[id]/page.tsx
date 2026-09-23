"use client";

import { ArrowLeft, Check, Clock3, ExternalLink, MoreHorizontal, RefreshCw, Save, Sparkles } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { CoverArt } from "@/components/cover-art";
import { readLocalMix, storeLocalMix } from "@/components/mix-storage";
import { SpotifyIcon } from "@/components/spotify-icon";
import type { MixRecord, PublicSession } from "@/lib/types";
import { formatDuration } from "@/lib/utils";

export default function MixResultPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [mix, setMix] = useState<MixRecord | null>(null);
  const [session, setSession] = useState<PublicSession | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.resolve().then(() => setMix(readLocalMix(params.id)));
    fetch("/api/auth/session").then((value) => value.json()).then(setSession).catch(() => null);
  }, [params.id]);

  async function saveToSpotify() {
    if (!mix) return;
    if (!session?.authenticated) { router.push("/api/auth/login"); return; }
    if (mix.spotifyUrl) { window.open(mix.spotifyUrl, "_blank", "noopener,noreferrer"); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/mixes/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mix }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save to Spotify.");
      setMix(data.mix); storeLocalMix(data.mix);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save to Spotify."); }
    finally { setSaving(false); }
  }

  if (!mix) return (
    <main className="app-shell min-h-screen"><AppHeader /><section className="empty-state"><span className="eyebrow">Mix not found</span><h1>This one slipped out of the crate.</h1><p>It may have been created in another browser or cleared from local history.</p><Link className="primary-cta" href="/mix"><ArrowLeft size={17} /> Make a new mix</Link></section></main>
  );

  return (
    <main className="app-shell min-h-screen pb-20">
      <AppHeader />
      <section className="result-shell">
        <div className="result-hero">
          <CoverArt src={mix.coverDataUrl} name={mix.name} className="result-cover" />
          <div className="result-copy">
            <span className="eyebrow">Your mix <i>{mix.status === "saved" ? "saved" : "ready"}</i></span>
            <h1>{mix.name}</h1>
            <p>{mix.description}</p>
            <div className="mix-meta"><span><Clock3 size={15} /> {mix.tracks.length} tracks</span><span><Sparkles size={15} /> {mix.stats.discoveries} discoveries</span></div>
            {mix.tracks.length < mix.targetCount && <p>Found {mix.tracks.length} matching tracks out of {mix.targetCount} requested. This mix stays within your request.</p>}
            <div className="result-actions">
              <button onClick={saveToSpotify} disabled={saving} className={`spotify-button ${mix.status === "saved" ? "saved" : ""}`}>
                {saving ? <RefreshCw className="animate-spin" size={21} /> : mix.status === "saved" ? <Check size={21} /> : <SpotifyIcon />}
                {saving ? "Saving…" : mix.status === "saved" ? "Saved to Spotify" : session?.authenticated ? "Save to Spotify" : "Connect Spotify to save"}
              </button>
              <Link href="/mix" className="secondary-button"><RefreshCw size={19} /> New mix</Link>
            </div>
            {mix.spotifyUrl && <a href={mix.spotifyUrl} target="_blank" rel="noreferrer" className="spotify-link">View in Spotify <ExternalLink size={14} /></a>}
            {error && <p className="inline-error">{error} <button onClick={saveToSpotify}>Retry</button></p>}
          </div>
        </div>

        <div className="tracklist">
          <div className="track-head"><span>#</span><span>Track</span><span>Artist</span><span>Time</span><span /></div>
          {mix.tracks.map((track, index) => (
            <div className="track-row" key={`${track.id}-${index}`}>
              <span className="track-number">{index + 1}</span>
              <div className="track-title"><strong>{track.name}</strong><small>{track.album}{track.explicit ? " · E" : ""}</small></div>
              <span className="track-artist">{track.artists.join(", ")}</span>
              <span className="track-time">{formatDuration(track.durationMs)}</span>
              {track.spotifyUrl ? <a href={track.spotifyUrl} target="_blank" rel="noreferrer" className="more-button" aria-label={`Open ${track.name} in Spotify`}><ExternalLink size={16} /></a> : <button className="more-button" aria-label={`More options for ${track.name}`}><MoreHorizontal size={19} /></button>}
            </div>
          ))}
        </div>
        <div className="playlist-note"><Save size={15} /><span>{mix.status === "saved" ? "This mix is safely in your Spotify library." : "Nothing has been added to Spotify yet. Save it only when it feels right."}</span></div>
      </section>
    </main>
  );
}
