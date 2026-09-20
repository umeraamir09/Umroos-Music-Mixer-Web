import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Umroo's Music Mixer — AI playlists that know your taste",
  description: "Describe a feeling. Get a Spotify playlist shaped around your taste, with just enough discovery.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-scroll-behavior="smooth"><body>{children}</body></html>;
}
