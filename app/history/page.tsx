"use client";

import { ArrowRight, Disc3, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { CoverArt } from "@/components/cover-art";
import { readLocalMixes } from "@/components/mix-storage";
import type { MixRecord } from "@/lib/types";

export default function HistoryPage() {
  const [mixes, setMixes] = useState<MixRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const local = readLocalMixes();
    Promise.resolve().then(() => { setMixes(local); if (local.length) setLoaded(true); });
    fetch("/api/history").then((value) => value.json()).then(({ mixes: remote }: { mixes: MixRecord[] }) => {
      const map = new Map([...local, ...(remote || [])].map((mix) => [mix.id, mix]));
      setMixes([...map.values()].sort((a, b) => b.createdAt - a.createdAt));
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  return (
    <main className="app-shell">
      <AppHeader />
      <section className="history-shell">
        <div className="app-section-label"><span>YOUR MUSIC / THE ARCHIVE</span><span className="app-label-rule" /></div>
        <div className="history-heading"><div><p className="app-overline">YOUR LISTENING JOURNAL</p><h1>Past <em>mixes.</em></h1><p>Every idea stays in the crate, whether you saved it to Spotify or kept it here.</p></div><Link className="secondary-button" href="/mix"><Plus size={18} /> New mix</Link></div>
        {!loaded ? <div className="history-loading" role="status">Opening your crate…</div> : mixes.length ? (
          <div className="history-grid">
            {mixes.map((mix) => (
              <Link href={`/mix/${mix.id}`} className="history-card" key={mix.id}>
                <CoverArt src={mix.coverDataUrl} name={mix.name} />
                <div className="history-card-copy"><div className="history-status"><span className={mix.status}>{mix.status === "saved" ? "SAVED TO SPOTIFY" : mix.status === "save_failed" ? "SAVE FAILED" : "NOT SAVED"}</span><time dateTime={new Date(mix.createdAt).toISOString()}>{new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(mix.createdAt)}</time></div><h2>{mix.name}</h2><p>{mix.description}</p><div className="history-bottom"><span>{mix.tracks.length} TRACKS</span><ArrowRight size={18} aria-hidden="true" /></div></div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="history-empty"><Disc3 size={48} strokeWidth={1.2} aria-hidden="true" /><span className="app-overline">NOTHING ON THE SHELF YET</span><h2>Your crate is waiting.</h2><p>Make a mix and it&apos;ll live here, whether you save it to Spotify or not.</p><Link className="primary-cta" href="/mix">Make your first mix <ArrowRight size={17} /></Link></div>
        )}
      </section>
    </main>
  );
}
