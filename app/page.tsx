import type { Metadata } from "next";
import { ArrowDownRight, ArrowRight, ArrowUpRight, AudioLines, Check, Disc3 } from "lucide-react";
import Link from "next/link";
import { getSpotifySession } from "@/lib/session";
import { SpotifyIcon } from "@/components/spotify-icon";
import { LandingMixPreview } from "./landing-mix-preview";
import styles from "./page.module.css";

const steps = [
  {
    number: "01",
    title: "Bring your taste",
    description: "Connect Spotify so the mixer can get to know the music you already love.",
    icon: Disc3,
  },
  {
    number: "02",
    title: "Set the scene",
    description: "Describe a mood, a moment, an artist, or something you can’t quite name.",
    icon: AudioLines,
  },
  {
    number: "03",
    title: "Make it yours",
    description: "Preview your new mix, then save it to Spotify when it feels right.",
    icon: Check,
  },
];

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default async function LandingPage() {
  const demo = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
  const authenticated = Boolean(await getSpotifySession());

  return (
    <main className={styles.page}>
      <div className={styles.heroShell}>
        <header className={styles.header}>
          <Link href="/" className={styles.brand} aria-label="Umroo's Music Mixer home">
            <span className={styles.brandDisc} aria-hidden="true"><span /></span>
            <span className={styles.brandName}>umroo&apos;s<span>music mixer</span></span>
          </Link>
          <nav className={styles.nav} aria-label="Main navigation">
            <a href="#the-idea">The idea</a>
            <a href="#how-it-works">How it works</a>
          </nav>
          {authenticated ? (
            <Link className={styles.headerCta} href="/mix">Go to app <ArrowRight size={17} strokeWidth={1.8} /></Link>
          ) : (
            <a className={styles.headerCta} href="/api/auth/login">Start mixing <ArrowUpRight size={17} strokeWidth={1.8} /></a>
          )}
        </header>

        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.eyebrow}><span className={styles.eyebrowStar}>✳</span> THE ART OF A BETTER PLAYLIST <span className={styles.eyebrowEnd}>/ VOL. 01</span></div>
          <h1 id="hero-title"><span>Playlists</span><span className={styles.heroTitleSecond}>By Your <em>Taste.</em></span></h1>
          <div className={styles.heroPrompt}>
            <LandingMixPreview />
          </div>
          <div className={styles.heroActions}>
            {authenticated ? (
              <Link className={styles.primaryCta} href="/mix">Go to app <ArrowRight size={18} strokeWidth={1.8} /></Link>
            ) : (
              <a className={styles.primaryCta} href="/api/auth/login"><SpotifyIcon /> Connect With Spotify <ArrowUpRight size={18} strokeWidth={1.8} /></a>
            )}
            {demo && <Link className={styles.secondaryCta} href="/mix">Try the demo <ArrowRight size={18} strokeWidth={1.8} /></Link>}
          </div>
          <p className={styles.heroFootnote}>We use your Spotify taste to shape your mix. Nothing is saved to Spotify until you choose.</p>
        </section>

        <div className={styles.heroTicker} aria-hidden="true">
          <span>YOUR MUSIC, REIMAGINED</span><i />
          <span>THE FAMILIAR</span><i />
          <span>THE UNEXPECTED</span><i />
          <span>ALL YOU</span>
          <ArrowDownRight size={20} strokeWidth={1.5} />
        </div>
      </div>

      <section id="the-idea" className={styles.idea} aria-labelledby="idea-title">
        <div className={styles.ideaInner}>
          <div className={styles.sectionLabel}><span>01 / THE IDEA</span><span className={styles.labelRule} /></div>
          <div className={styles.ideaGrid}>
            <div className={styles.ideaHeading}>
              <h2 id="idea-title">Somewhere between <em>known</em> &amp; new.</h2>
              <div className={styles.ideaDisc} aria-hidden="true"><span>YOUR<br />SOUND<br />LIVES<br />HERE <ArrowUpRight size={19} /></span></div>
            </div>
            <div className={styles.ideaBody}>
              <p className={styles.ideaIntro}>The best discoveries still sound a little like home.</p>
              <p>Your listening history gives us the starting point. Your words tell us where to go. Together, they become a playlist that fits the exact feeling you came for.</p>
              <div className={styles.sides}>
                <div><span>SIDE A / THE FAMILIAR</span><strong>The songs you love.</strong><p>Favorites and artists that already feel like yours.</p></div>
                <div><span>SIDE B / THE DISCOVERY</span><strong>The songs you&apos;ll love.</strong><p>Fresh finds that belong right beside them.</p></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className={styles.how} aria-labelledby="how-title">
        <div className={styles.howInner}>
          <div className={styles.sectionLabel}><span>02 / THE PROCESS</span><span className={styles.labelRule} /></div>
          <div className={styles.howHeading}><h2 id="how-title">A good mix starts <em>with you.</em></h2><p>Three simple steps from a passing thought to your next favorite playlist.</p></div>
          <div className={styles.steps}>
            {steps.map((step) => <article className={styles.step} key={step.number}>
              <div className={styles.stepTop}><span>{step.number} / 03</span><step.icon size={30} strokeWidth={1.35} aria-hidden="true" /></div>
              <h3>{step.title}</h3><p>{step.description}</p>
            </article>)}
          </div>
          <div className={styles.promptCard}>
            <div className={styles.promptLabel}><span>✳</span> A LITTLE INSPIRATION</div>
            <p>“Slow, late-night R&amp;B. Mostly the artists I know, with a few new voices in the mix.”</p>
            <span className={styles.promptNote}>There&apos;s no wrong way to ask.</span>
          </div>
        </div>
      </section>

      <section className={styles.finalCta} aria-labelledby="final-title">
        <div className={styles.finalInner}>
          <div className={styles.finalLabel}>THE NEXT TRACK IS YOURS <span>✳</span></div>
          <h2 id="final-title">What are you<br />in the <em>mood</em> for?</h2>
          <div className={styles.finalActions}>
            {authenticated ? (
              <Link href="/mix">Go to app <ArrowRight size={20} strokeWidth={1.7} /></Link>
            ) : (
              <a href="/api/auth/login">Connect with Spotify <ArrowUpRight size={20} strokeWidth={1.7} /></a>
            )}
            {demo && <Link href="/mix">Explore the demo <ArrowRight size={18} /></Link>}
          </div>
          <div className={styles.finalRecord} aria-hidden="true"><div /></div>
        </div>
      </section>
      <footer className={styles.footer}><span>© {new Date().getFullYear()} Umroo&apos;s Music Mixer</span><span>Made for the way you listen <span aria-hidden="true">✳</span></span><a href="#hero-title">Back to top ↑</a></footer>
    </main>
  );
}
