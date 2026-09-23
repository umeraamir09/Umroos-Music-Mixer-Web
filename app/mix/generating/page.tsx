"use client";

import { AlertCircle, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { storeLocalMix } from "@/components/mix-storage";
import type { MixRecord } from "@/lib/types";

const phases = ["Reading between the lines…", "Learning the shape of your taste…", "Filling in every song's details…", "Letting Jev audition every track…", "Sequencing the perfect flow…", "Finishing the cover art…"];

export default function GeneratingPage() {
  const router = useRouter();
  const started = useRef(false);
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setPhase((value) => Math.min(phases.length - 1, value + 1)), 1700);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const prompt = sessionStorage.getItem("umm_pending_prompt");
    if (!prompt) { router.replace("/mix"); return; }
    const began = Date.now();
    fetch("/api/mixes/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Your mix could not be generated.");
        return data.mix as MixRecord;
      })
      .then(async (mix) => {
        storeLocalMix(mix);
        sessionStorage.removeItem("umm_pending_prompt");
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, 3800 - (Date.now() - began))));
        router.replace(`/mix/${mix.id}`);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Something went wrong."));
  }, [router]);

  return (
    <main className="app-shell min-h-screen overflow-hidden">
      <AppHeader />
      <section className="generation-stage">
        <div className="text-center">
          <p className="eyebrow mb-4">Taste, interpreted</p>
          <h1 className="page-title single-line">Making your mix<span className="accent-dot">.</span></h1>
          <p className="page-subtitle">Sit back — I&apos;m blending the perfect tracks for you.</p>
        </div>
        <div className="vinyl-wrap" aria-label="Playlist generation in progress">
          <div className="vinyl"><span className="vinyl-label"><i /></span></div>
          <svg className="progress-arc" viewBox="0 0 100 100"><circle cx="50" cy="50" r="47" /></svg>
        </div>
        {!error ? (
          <div className="phase-copy"><span>{phases[phase]}</span><div className="phase-dots">{phases.map((_, index) => <i key={index} className={index <= phase ? "done" : ""} />)}</div></div>
        ) : (
          <div className="error-card"><AlertCircle size={20} /><div><strong>The mix hit a skip.</strong><p>{error}</p></div><Link href="/mix"><ArrowLeft size={16} /> Try again</Link></div>
        )}
      </section>
    </main>
  );
}
