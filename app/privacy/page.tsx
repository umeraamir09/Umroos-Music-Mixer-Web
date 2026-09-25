import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy", alternates: { canonical: "/privacy" } };

export default function PrivacyPage() {
  return <main className="privacy-page">
    <Link href="/">← Back to Music Mixer</Link>
    <h1>Privacy</h1>
    <p>This portfolio app offers a public demo and an invite-only Spotify connection.</p>
    <h2>Public demo</h2>
    <p>Demo prompts are sent to the configured AI planning and cover providers. With Spotify credentials configured, the server searches Spotify&apos;s catalog using an application token without accessing your Spotify account. Demo mixes and artwork are stored in your browser. A sealed visitor cookie and daily counts in Convex limit requests; the counter does not store your email or Spotify account.</p>
    <h2>Access requests</h2>
    <p>If you request Spotify access, the email you enter is stored in Convex and sent through Resend to the project owner for manual review. Resend also sends you a confirmation at that address. Your email is not used for marketing, and submitting it does not grant access. The project owner can remove access requests from Convex after review.</p>
    <h2>Connected Spotify accounts</h2>
    <p>Spotify tokens are kept in an encrypted, HttpOnly session cookie. The app reads your library to create mixes and stores your profile and mix history in Convex. The app&apos;s AI planning and cover requests contain your prompt, not Spotify supplied library or track metadata. The app sends track identifiers to music metadata services to enrich results. A playlist is created in your account only when you choose to save it.</p>
    <h2>Human verification</h2>
    <p>Cloudflare Turnstile checks demo generations and access requests for automated use. Read Cloudflare&apos;s <a href="https://www.cloudflare.com/turnstile-privacy-policy/" target="_blank" rel="noreferrer">Turnstile Privacy Addendum</a>.</p>
  </main>;
}
