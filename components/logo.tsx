import Link from "next/link";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="group inline-flex items-center gap-3" aria-label="Umroo's Music Mixer home">
      <span className="logo-mark" aria-hidden="true"><i /><i /><i /></span>
      {!compact && <span className="font-display text-[17px] font-semibold tracking-[-0.035em] sm:text-[20px]">Umroo&apos;s Music Mixer</span>}
    </Link>
  );
}
