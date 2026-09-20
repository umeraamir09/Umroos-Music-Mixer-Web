"use client";

import { ArrowUp, CloudRain, Coffee, Mic, Moon } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

const ideas = [
  { icon: Moon, label: "Late-night drive", prompt: "A late-night drive playlist with warm synths, dreamy indie and R&B. Keep it familiar with a few discoveries." },
  { icon: Coffee, label: "Cozy café jazz", prompt: "Cozy café jazz for a slow afternoon. Warm, tasteful, mostly instrumental and never distracting." },
  { icon: CloudRain, label: "Rainy evening R&B", prompt: "Rainy evening R&B. Soft, intimate and unhurried, with artists I love and a few new voices." },
];

export function PromptComposer() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [listening, setListening] = useState(false);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (prompt.trim().length < 3) return;
    sessionStorage.setItem("umm_pending_prompt", prompt.trim());
    router.push("/mix/generating");
  }

  function speech() {
    const SpeechRecognition = (window as typeof window & { webkitSpeechRecognition?: new () => { lang: string; start(): void; onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void } }).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.onresult = (event) => setPrompt((value) => `${value} ${event.results[0][0].transcript}`.trim());
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
  }

  return (
    <div className="w-full max-w-[1050px]">
      <form onSubmit={submit} className="composer-card">
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={1200} aria-label="Describe your playlist" placeholder="Tell me what kind of playlist you want…" />
        <div className="composer-actions">
          <button type="button" onClick={speech} className={`mic-button ${listening ? "listening" : ""}`} aria-label="Use voice input"><Mic size={21} /></button>
          <button type="submit" disabled={prompt.trim().length < 3} className="submit-button" aria-label="Make my mix"><ArrowUp size={23} strokeWidth={2.2} /></button>
        </div>
      </form>
      <div className="idea-row">
        {ideas.map(({ icon: Icon, label, prompt: idea }) => (
          <button key={label} onClick={() => setPrompt(idea)} className="idea-chip"><Icon size={20} /><span>{label}</span><ArrowUp className="rotate-90 opacity-55" size={17} /></button>
        ))}
      </div>
    </div>
  );
}
