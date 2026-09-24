"use client";

import { ArrowUpRight, Disc3, LogOut, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/logo";
import { SpotifyIcon } from "@/components/spotify-icon";
import type { PublicSession } from "@/lib/types";

export function AppHeader({ minimal = false }: { minimal?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<PublicSession | null | undefined>(undefined);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/session").then((value) => value.json()).then(setSession).catch(() => setSession(null));
  }, []);

  useEffect(() => {
    if (!accountOpen) return;
    function closeOnOutsideClick(event: PointerEvent) {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setAccountOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountOpen]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAccountOpen(false);
    router.push("/");
    router.refresh();
  }

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Logo />
        {!minimal && (
          <div className="app-header-right">
            <nav className="app-header-nav" aria-label="App navigation">
              <Link href="/mix" aria-label="Make a mix" aria-current={pathname === "/mix" ? "page" : undefined}>
                <Plus size={17} strokeWidth={1.8} aria-hidden="true" /><span>Make a mix</span>
              </Link>
              <Link href="/history" aria-label="Your mixes" aria-current={pathname === "/history" ? "page" : undefined}>
                <Disc3 size={17} strokeWidth={1.8} aria-hidden="true" /><span>Your mixes</span>
              </Link>
            </nav>
            {session === undefined ? <span className="app-account-loading" aria-hidden="true" /> : session?.authenticated ? (
              <div className="app-account" ref={accountRef}>
                <button type="button" className="app-account-trigger" aria-label="Account menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}>
                  <span className="app-account-dot" aria-hidden="true" />
                  <span className="app-account-initial">{session.user?.displayName?.trim().charAt(0).toUpperCase() || "U"}</span>
                </button>
                {accountOpen && (
                  <div className="app-account-menu">
                    <span className="app-account-caption">CONNECTED TO SPOTIFY</span>
                    <strong>{session.user?.displayName || "Your account"}</strong>
                    <button type="button" onClick={logout}><LogOut size={16} strokeWidth={1.8} aria-hidden="true" /> Disconnect Spotify</button>
                  </div>
                )}
              </div>
            ) : (
              <a className="app-connect" href="/api/auth/login" aria-label="Connect Spotify">
                <SpotifyIcon /><span>Connect Spotify</span><ArrowUpRight size={16} strokeWidth={1.8} aria-hidden="true" />
              </a>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
