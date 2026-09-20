"use client";

import { History, LogOut, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import type { PublicSession } from "@/lib/types";

export function AppHeader({ minimal = false }: { minimal?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<PublicSession | null>(null);

  useEffect(() => { fetch("/api/auth/session").then((value) => value.json()).then(setSession).catch(() => null); }, []);
  const initial = session?.user?.displayName?.trim().charAt(0).toUpperCase() || "U";

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <header className="relative z-20 mx-auto flex w-full max-w-[1480px] items-center justify-between px-5 py-5 sm:px-8 lg:px-12 lg:py-8">
      <Logo />
      {!minimal && (
        <div className="flex items-center gap-2 sm:gap-3">
          {pathname !== "/mix" && <Link className="header-action" href="/mix"><Plus size={17} /><span className="hidden sm:inline">New mix</span></Link>}
          <Link className={`header-action ${pathname === "/history" ? "active" : ""}`} href="/history"><History size={17} /><span className="hidden sm:inline">History</span></Link>
          <div className="group relative">
            <button className="avatar" aria-label="Account menu">{initial}</button>
            {session?.authenticated && (
              <button onClick={logout} className="account-popover"><LogOut size={15} /> Disconnect Spotify</button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
