import { ArrowRight, AudioLines, Compass, Sparkles } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { SpotifyIcon } from "@/components/spotify-icon";

export default function LandingPage() {
  const demo = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
  return (
    <main className="landing-shell">
      <header className="landing-nav"><Logo /><span className="eyebrow hidden sm:inline">Made for the way you listen</span></header>
      <section className="landing-grid">
        <div className="landing-copy">
          <span className="landing-pill"><Sparkles size={14} /> Your taste, understood</span>
          <h1>A playlist that already feels <em>like yours.</em></h1>
          <p>Tell us the mood, the moment, or just one song. We&apos;ll blend what you love with what you&apos;ll love next.</p>
          <div className="landing-ctas">
            <a href="/api/auth/login" className="primary-cta"><SpotifyIcon /> Connect Spotify <ArrowRight size={18} /></a>
            {demo && <Link href="/mix" className="text-cta">Try the demo <ArrowRight size={16} /></Link>}
          </div>
          <small>We only use your listening data to make your mixes. Nothing is saved to Spotify without your approval.</small>
        </div>
        <div className="taste-orbit" aria-hidden="true">
          <div className="orbit-ring ring-one" /><div className="orbit-ring ring-two" /><div className="orbit-ring ring-three" />
          <div className="orbit-core"><AudioLines size={40} /><strong>your sound</strong><span>in perfect orbit</span></div>
          <div className="orbit-card card-a"><span>familiar</span><b>72%</b></div>
          <div className="orbit-card card-b"><Compass size={17} /><span>new finds</span></div>
          <div className="orbit-card card-c"><i /> softly energetic</div>
        </div>
      </section>
    </main>
  );
}
