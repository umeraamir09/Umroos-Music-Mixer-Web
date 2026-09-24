import type { Metadata } from "next";
import { DM_Sans, Pixelify_Sans } from "next/font/google";
import { MixTransitionProvider } from "@/components/mix-transition-context";
import { SpotifyAccessDialog } from "@/components/spotify-access-dialog";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin"], weight: "variable", display: "swap", variable: "--font-landing-sans" });
const pixelifySans = Pixelify_Sans({ subsets: ["latin"], weight: "variable", display: "swap", variable: "--font-landing-pixel" });

export const metadata: Metadata = {
  metadataBase: siteUrl,
  applicationName: "Umroo's Music Mixer",
  title: {
    default: "AI Spotify Playlist Generator | Umroo's Music Mixer",
    template: "%s | Umroo's Music Mixer",
  },
  description: "Describe a mood, moment, or artist and get a Spotify playlist shaped around your listening taste, balancing familiar favorites with new discoveries.",
  keywords: [
    "AI Spotify playlist generator",
    "AI playlist maker",
    "personalized Spotify playlists",
    "playlist by mood",
    "music discovery",
  ],
  creator: "Umroo's Music Mixer",
  publisher: "Umroo's Music Mixer",
  openGraph: {
    type: "website",
    siteName: "Umroo's Music Mixer",
    locale: "en_US",
    title: "AI Spotify Playlist Generator | Umroo's Music Mixer",
    description: "Describe a mood, moment, or artist and get a Spotify playlist shaped around your listening taste, balancing familiar favorites with new discoveries.",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Spotify Playlist Generator | Umroo's Music Mixer",
    description: "Describe a mood, moment, or artist and get a Spotify playlist shaped around your listening taste, balancing familiar favorites with new discoveries.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-scroll-behavior="smooth" className={`${dmSans.variable} ${pixelifySans.variable}`}><body><SpotifyAccessDialog><MixTransitionProvider>{children}</MixTransitionProvider></SpotifyAccessDialog></body></html>;
}
