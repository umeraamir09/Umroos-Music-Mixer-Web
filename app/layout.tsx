import type { Metadata } from "next";
import { DM_Sans, Pixelify_Sans } from "next/font/google";
import { MixTransitionProvider } from "@/components/mix-transition-context";
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin"], weight: "variable", display: "swap", variable: "--font-landing-sans" });
const pixelifySans = Pixelify_Sans({ subsets: ["latin"], weight: "variable", display: "swap", variable: "--font-landing-pixel" });

export const metadata: Metadata = {
  title: "Umroo's Music Mixer — AI playlists that know your taste",
  description: "Describe a feeling. Get a Spotify playlist shaped around your taste, with just enough discovery.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-scroll-behavior="smooth" className={`${dmSans.variable} ${pixelifySans.variable}`}><body><MixTransitionProvider>{children}</MixTransitionProvider></body></html>;
}
