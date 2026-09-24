"use client";

import { ArrowLeft, ArrowRight, Check, Clock3, ExternalLink, Paintbrush, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, ViewTransition } from "react";
import { AppHeader } from "@/components/app-header";
import { InteractiveCoverArt } from "@/components/interactive-cover-art";
import { publicUserId, readLocalMix, storeLocalMix } from "@/components/mix-storage";
import { useMixTransition } from "@/components/mix-transition-context";
import { SpotifyIcon } from "@/components/spotify-icon";
import { TrackArtwork } from "@/components/track-artwork";
import type { MixRecord, PublicSession } from "@/lib/types";
import { formatDuration } from "@/lib/utils";

export default function MixResultPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { getPreparedMix, clearPreparedMix } = useMixTransition();
  const [initialMix] = useState(() => getPreparedMix(params.id));
  const [mix, setMix] = useState<MixRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const arriving = initialMix !== null;
  const [session, setSession] = useState<PublicSession | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/session").then((value) => value.json() as Promise<PublicSession>).then(async (current) => {
      setSession(current);
      const userId = publicUserId(current);
      if (initialMix && initialMix.userId === userId) { setMix(initialMix); return; }
      const local = readLocalMix(params.id, userId);
      if (local) { setMix(local); return; }
      const response = await fetch("/api/history");
      const { mixes } = await response.json() as { mixes: MixRecord[] };
      setMix(mixes?.find((item) => item.id === params.id && item.userId === userId) || null);
    }).catch(() => setMix(null)).finally(() => setLoaded(true));
  }, [params.id, initialMix]);

  useEffect(() => {
    if (!initialMix) return;
    const timer = window.setTimeout(() => clearPreparedMix(initialMix.id), 3300);
    return () => window.clearTimeout(timer);
  }, [initialMix, clearPreparedMix]);

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

  if (!loaded) return <main className="app-shell"><AppHeader /><section className="empty-state" role="status"><span className="app-overline">OPENING THE CRATE</span><h1>Finding your mix…</h1></section></main>;

  if (!mix) return <main className="app-shell"><AppHeader /><section className="empty-state"><span className="app-overline">MIX NOT FOUND</span><h1>This one slipped out of the crate.</h1><p>It may have been created in another browser or cleared from local history.</p><Link className="primary-cta" href="/mix"><ArrowLeft size={17} /> Make a new mix</Link></section></main>;

  return (
    <main className="app-shell">
      <AppHeader />
      <section className="result-shell">
        <div className="result-hero">
          {arriving ? <ViewTransition name="mix-cover-handoff" share="mix-cover-share" default="none"><InteractiveCoverArt src={mix.coverDataUrl} name={mix.name} /></ViewTransition> : <InteractiveCoverArt src={mix.coverDataUrl} name={mix.name} />}
          <ViewTransition enter={arriving ? "mix-title-enter" : "none"} default="none"><div className="result-copy">
            <span className="result-overline"> <i>{mix.status === "saved" ? "SAVED" : "READY TO PREVIEW"}</i></span>
            <h1>{mix.name}</h1>
            <p>{mix.description}</p>
            <div className="mix-meta"><span><Clock3 size={16} /> {mix.tracks.length} tracks</span><span><Sparkles size={16} /> {mix.stats.discoveries} discoveries</span></div>
            {mix.tracks.length < mix.targetCount && <p className="result-shortfall">Found {mix.tracks.length} matching tracks out of {mix.targetCount} requested. This mix stays within your request.</p>}
            <div className="result-actions">
              <button onClick={saveToSpotify} disabled={saving} className="spotify-button">
                {saving ? <RefreshCw className="saving-spin" size={19} /> : mix.spotifyUrl ? <ExternalLink size={18} /> : mix.status === "saved" ? <Check size={18} /> : <SpotifyIcon />}
                {saving ? "Saving…" : mix.spotifyUrl ? "Open in Spotify" : mix.status === "saved" ? "Saved to Spotify" : session?.authenticated ? "Save to Spotify" : "Connect Spotify to save"}
              </button>
              <Link href={`/mix/${mix.id}/art`} className="secondary-button"><Paintbrush size={18} /> Create your own playlist art</Link>
              <Link href="/mix" className="secondary-button">Make another mix <ArrowRight size={18} /></Link>
            </div>
            <p className="result-save-note">{mix.status === "saved" ? "This mix is in your Spotify library." : "Nothing has been added to Spotify yet. Save it when it feels right."}</p>
            {error && <p className="inline-error" role="alert">{error} <button onClick={saveToSpotify}>Retry</button></p>}
          </div></ViewTransition>
        </div>

        <ViewTransition enter={arriving ? "mix-tracks-enter" : "none"} default="none"><section className="tracklist" aria-labelledby="tracklist-title">
          <div className="tracklist-heading"><div><span className="app-overline">SIDE A / THE LISTEN</span><h2 id="tracklist-title">On the record.</h2></div><span>{mix.tracks.length} TRACKS / YOUR MIX</span></div>
          <div className="track-head"><span>#</span><span>Track</span><span>Artist</span><span>In the mix</span><span>Time</span><span /></div>
          {mix.tracks.map((track, index) => (
            <div className="track-row" key={`${track.id}-${index}`}>
              <span className="track-number">{index + 1}</span>
              <div className="track-title"><TrackArtwork src={track.imageUrl} /><span className="track-title-copy"><strong>{track.name}</strong><small>{track.album}<span className="track-mobile-artist"> · {track.artists.join(", ")}</span>{track.explicit ? " · E" : ""}</small></span></div>
              <span className="track-artist">{track.artists.join(", ")}</span>
              <span className="track-kind">{track.familiar ? "FAMILIAR" : "DISCOVERY"}</span>
              <span className="track-time">{formatDuration(track.durationMs)}</span>
              {track.spotifyUrl ? <a href={track.spotifyUrl} target="_blank" rel="noreferrer" className="track-link" aria-label={`Open ${track.name} in Spotify`}><ExternalLink size={17} /></a> : <span aria-hidden="true" />}
            </div>
          ))}
        </section></ViewTransition>
      </section>
    </main>
  );
}
