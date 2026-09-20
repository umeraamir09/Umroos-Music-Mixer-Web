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
  useEffect(() => {
    const local = readLocalMixes();
    Promise.resolve().then(() => setMixes(local));
    fetch("/api/history").then((value) => value.json()).then(({ mixes: remote }: { mixes: MixRecord[] }) => {
      const map = new Map([...local, ...(remote || [])].map((mix) => [mix.id, mix]));
      setMixes([...map.values()].sort((a, b) => b.createdAt - a.createdAt));
    }).catch(() => null);
  }, []);

  return (
    <main className="app-shell min-h-screen pb-20">
      <AppHeader />
      <section className="history-shell">
        <div className="history-heading"><div><p className="eyebrow mb-3">Your listening journal</p><h1>Past mixes<span className="accent-dot">.</span></h1><p>Every idea stays here — saved to Spotify or not.</p></div><Link className="secondary-button" href="/mix"><Plus size={18} /> New mix</Link></div>
        {mixes.length ? (
          <div className="history-grid">
            {mixes.map((mix) => (
              <Link href={`/mix/${mix.id}`} className="history-card" key={mix.id}>
                <CoverArt src={mix.coverDataUrl} name={mix.name} />
                <div className="history-card-copy"><div className="history-status"><span className={mix.status}>{mix.status === "saved" ? "Saved to Spotify" : "Not saved yet"}</span><time>{new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(mix.createdAt)}</time></div><h2>{mix.name}</h2><p>{mix.description}</p><div className="history-bottom"><span>{mix.tracks.length} tracks</span><ArrowRight size={18} /></div></div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="history-empty"><Disc3 size={46} /><h2>Your crate is waiting.</h2><p>Make a mix and it&apos;ll live here, whether you save it to Spotify or not.</p><Link className="primary-cta" href="/mix">Make your first mix <ArrowRight size={17} /></Link></div>
        )}
      </section>
    </main>
  );
}
