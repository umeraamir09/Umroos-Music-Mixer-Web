import Link from "next/link";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/mix" className="app-brand" aria-label="Umroo's Music Mixer app home">
      <span className="app-brand-disc" aria-hidden="true"><span /></span>
      {!compact && <span className="app-brand-name">umroo&apos;s<span>music mixer</span></span>}
    </Link>
  );
}
