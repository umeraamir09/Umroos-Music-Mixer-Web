"use client";

import { ArrowUp, ArrowUpRight, Mic } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState, ViewTransition } from "react";
import { storeLocalMix } from "@/components/mix-storage";
import { useMixTransition } from "@/components/mix-transition-context";
import { TimeGreeting } from "@/components/time-greeting";
import type { MixRecord } from "@/lib/types";

const promptSuggestions = [
  "Late-night R&B with familiar voices and a few new finds.",
  "An indie mix for the ride home — soft, warm, hopeful.",
  "Cozy café jazz for a slow afternoon.",
];

type TypingFrame = { index: number; length: number; direction: "typing" | "erasing" };

const ideas = [
  { label: "Late-night drive", prompt: "A late-night drive playlist with warm synths, dreamy indie and R&B. Keep it familiar with a few discoveries." },
  { label: "Cozy café jazz", prompt: "Cozy café jazz for a slow afternoon. Warm, tasteful, mostly instrumental and never distracting." },
  { label: "Rainy evening R&B", prompt: "Rainy evening R&B. Soft, intimate and unhurried, with artists I love and a few new voices." },
];

const progressLines = [
  "Brewing the coffee.",
  "Closing the curtains.",
  "Finding the correct vibe.",
  "Waking the DJ up.",
  "Dancing to the music.",
  "Asking the bass to behave.",
  "Giving the chorus another listen.",
  "Putting the good songs first.",
];

type GenerationPhase = "idle" | "morphing" | "looping";

export function PromptComposer() {
  const router = useRouter();
  const { prepareMix } = useMixTransition();
  const [prompt, setPrompt] = useState("");
  const [submittedPrompt, setSubmittedPrompt] = useState("");
  const [phase, setPhase] = useState<GenerationPhase>("idle");
  const [error, setError] = useState("");
  const [progressIndex, setProgressIndex] = useState(0);
  const [listening, setListening] = useState(false);
  const [speechMessage, setSpeechMessage] = useState("");
  const [focused, setFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [typingFrame, setTypingFrame] = useState<TypingFrame>({ index: 0, length: 0, direction: "typing" });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const isGenerating = phase !== "idle";

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    if (phase !== "morphing") return;
    const timer = window.setTimeout(() => setPhase("looping"), reducedMotion ? 0 : 760);
    return () => window.clearTimeout(timer);
  }, [phase, reducedMotion]);

  useEffect(() => {
    if (!isGenerating || reducedMotion) return;
    const timer = window.setInterval(() => setProgressIndex((index) => (index + 1) % progressLines.length), 3200);
    return () => window.clearInterval(timer);
  }, [isGenerating, reducedMotion]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    const initial = window.setTimeout(update, 0);
    preference.addEventListener("change", update);
    return () => { window.clearTimeout(initial); preference.removeEventListener("change", update); };
  }, []);

  useEffect(() => {
    if (focused || prompt || reducedMotion || isGenerating) return;

    const suggestion = promptSuggestions[typingFrame.index];
    let delay: number;
    let next: TypingFrame;

    if (typingFrame.direction === "typing" && typingFrame.length < suggestion.length) {
      delay = 42;
      next = { ...typingFrame, length: typingFrame.length + 1 };
    } else if (typingFrame.direction === "typing") {
      delay = 2300;
      next = { ...typingFrame, direction: "erasing" };
    } else if (typingFrame.length > 0) {
      delay = 22;
      next = { ...typingFrame, length: typingFrame.length - 1 };
    } else {
      delay = 440;
      next = { index: (typingFrame.index + 1) % promptSuggestions.length, length: 0, direction: "typing" };
    }

    const timer = window.setTimeout(() => setTypingFrame(next), delay);
    return () => window.clearTimeout(timer);
  }, [focused, prompt, reducedMotion, isGenerating, typingFrame]);

  const placeholder = focused
    ? "Describe the mix you want…"
    : reducedMotion
      ? promptSuggestions[0]
      : promptSuggestions[typingFrame.index].slice(0, typingFrame.length);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const requestedPrompt = prompt.trim();
    if (requestedPrompt.length < 3 || requestRef.current) return;

    const controller = new AbortController();
    requestRef.current = controller;
    setError("");
    setSubmittedPrompt(requestedPrompt);
    setProgressIndex(0);
    setPhase("morphing");
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const began = performance.now();

    try {
      const response = await fetch("/api/mixes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: requestedPrompt }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Your mix could not be generated.");
      const mix = data.mix as MixRecord;
      storeLocalMix(mix);
      prepareMix(mix);
      const destination = `/mix/${mix.id}`;
      router.prefetch(destination);
      const artwork = mix.coverDataUrl ? new window.Image() : null;
      if (artwork && mix.coverDataUrl) artwork.src = mix.coverDataUrl;
      const coverReady = artwork && typeof artwork.decode === "function" ? artwork.decode().catch(() => {}) : Promise.resolve();
      const remaining = Math.max(0, (reducedMotion ? 0 : 850) - (performance.now() - began));
      await Promise.all([coverReady, new Promise((resolve) => window.setTimeout(resolve, remaining))]);
      if (!controller.signal.aborted) router.replace(destination, { transitionTypes: ["mix-finished"] });
    } catch (reason) {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : "Something went wrong. Please try again.");
      setPhase("idle");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  function speech() {
    const SpeechRecognition = (window as typeof window & { webkitSpeechRecognition?: new () => { lang: string; start(): void; onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void } }).webkitSpeechRecognition;
    if (!SpeechRecognition) { setSpeechMessage("Voice input isn’t available in this browser."); return; }
    setSpeechMessage("");
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.onresult = (event) => setPrompt((value) => `${value} ${event.results[0][0].transcript}`.trim());
    recognition.onend = () => setListening(false);
    setListening(true);
    try { recognition.start(); } catch {
      setListening(false);
      setSpeechMessage("Voice input couldn’t start. Try typing your prompt.");
    }
  }

  return (
    <section className={`prompt-stage ${isGenerating ? "is-generating" : ""}`} aria-label="Make a mix">
      <div className="prompt-intro" aria-hidden={isGenerating}>
        <TimeGreeting />
      </div>
      <div className="composer-shell">
        <div className="mixer-shape-stage">
          <ViewTransition name={isGenerating ? "mix-cover-handoff" : "mix-prompt-idle"} share={isGenerating ? "mix-cover-share" : "none"} default="none"><form onSubmit={submit} className={`composer-card mixer-shape ${phase === "morphing" ? "is-morphing" : ""} ${phase === "looping" ? "is-looping" : ""}`}>
            <div className="composer-content" aria-hidden={isGenerating}>
              <label className="composer-label" htmlFor="mix-prompt">ASK YOUR AI MIXER</label>
              <textarea id="mix-prompt" ref={textareaRef} value={prompt} onChange={(event) => { setPrompt(event.target.value); setError(""); }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} disabled={isGenerating} maxLength={1200} placeholder={placeholder} />
              <div className="composer-bottom">
                {prompt.length > 1000 && <span className="composer-count">{1200 - prompt.length} characters left</span>}
                <div className="composer-actions">
                  <button type="button" onClick={speech} disabled={isGenerating} className={`mic-button ${listening ? "listening" : ""}`} aria-label="Use voice input" aria-pressed={listening}><Mic size={21} strokeWidth={1.8} aria-hidden="true" /></button>
                  <button type="submit" disabled={isGenerating || prompt.trim().length < 3} className="submit-button" aria-label="Make my mix"><ArrowUp size={23} strokeWidth={1.9} aria-hidden="true" /></button>
                </div>
              </div>
            </div>
          </form></ViewTransition>
        </div>
        <div className="mix-progress">
          {isGenerating && <div className="mix-progress-inner">
            <p className="mix-progress-overline">02 / IN THE MAKING</p>
            <h2 aria-hidden="true" key={progressIndex}>{progressLines[progressIndex]}</h2>
            <p className="mix-progress-status" role="status">Making your mix. We&apos;re finding tracks that fit your words and flow together.</p>
            <p className="mix-progress-prompt"><span>THE FEELING YOU GAVE US</span>“{submittedPrompt}”</p>
          </div>}
        </div>
        {error && <div className="composer-error" role="alert"><strong>The mix hit a skip.</strong><span>{error}</span><button type="button" onClick={() => void submit()}>Try again <ArrowUpRight size={16} aria-hidden="true" /></button></div>}
        {speechMessage && !isGenerating && <p className="composer-message" role="status">{speechMessage}</p>}
        <div className="idea-row" role="group" aria-label="Prompt ideas" aria-hidden={isGenerating}>
          {ideas.map(({ label, prompt: idea }) => (
            <button type="button" key={label} disabled={isGenerating} onClick={() => { setPrompt(idea); textareaRef.current?.focus(); }} className="idea-chip">{label}<ArrowUpRight size={15} strokeWidth={1.7} aria-hidden="true" /></button>
          ))}
        </div>
      </div>
    </section>
  );
}
