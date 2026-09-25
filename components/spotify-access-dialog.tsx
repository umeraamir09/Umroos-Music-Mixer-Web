"use client";

import { ArrowRight, X } from "lucide-react";
import Link from "next/link";
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { getTurnstileToken } from "@/lib/turnstile-client";

export function openSpotifyAccess() {
  window.dispatchEvent(new Event("umm:spotify-access"));
}

export function SpotifyAccessDialog({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onLink = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target.closest("a[href^='/api/auth/login']") : null;
      if (!element || element.hasAttribute("data-spotify-invited")) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("umm:spotify-access", onOpen);
    document.addEventListener("click", onLink, true);
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "spotify_profile") {
      setError("Spotify could not connect this account. Check that its email is on the invite list.");
      setOpen(true);
      params.delete("error");
      window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
    }
    return () => { window.removeEventListener("umm:spotify-access", onOpen); document.removeEventListener("click", onLink, true); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(timer); document.removeEventListener("keydown", onKey); previouslyFocused?.focus(); };
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (status === "sending") return;
    setError("");
    setStatus("sending");
    try {
      const turnstileToken = await getTurnstileToken("access_request");
      const response = await fetch("/api/access-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not send your request.");
      setStatus("sent");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send your request.");
      setStatus("idle");
    }
  }

  return <>
    {children}
    {open && <div className="spotify-access-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="spotify-access-dialog" role="dialog" aria-modal="true" aria-labelledby="spotify-access-title">
        <button className="spotify-access-close" type="button" onClick={() => setOpen(false)} aria-label="Close"><X size={20} /></button>
        <span className="app-overline">SPOTIFY ACCESS</span>
        <h2 id="spotify-access-title">Live Spotify access is invite only.</h2>
        <p>Spotify limits development mode to five approved users. You can request a spot if one is available, or try the public demo now.</p>
        {status === "sent" ? <p className="spotify-access-success" role="status">Request received. If access becomes available, your email can be added to the Spotify invite list.</p> : <form onSubmit={submit}>
          <label htmlFor="spotify-access-email">Email for a possible invite</label>
          <div className="spotify-access-form-row">
            <input ref={inputRef} id="spotify-access-email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
            <button type="submit" disabled={status === "sending"}>{status === "sending" ? "Sending…" : "Request access"}</button>
          </div>
          <small>Your email is stored only to review this request. Sending it does not grant access automatically. <Link href="/privacy" onClick={() => setOpen(false)}>Privacy details</Link></small>
        </form>}
        {error && <p className="spotify-access-error" role="alert">{error}</p>}
        <div className="spotify-access-actions">
          <Link href="/mix" onClick={() => setOpen(false)}>Try demo instead <ArrowRight size={17} /></Link>
          <a href="/api/auth/login" data-spotify-invited="true">Already invited? Connect Spotify</a>
        </div>
      </section>
    </div>}
  </>;
}
