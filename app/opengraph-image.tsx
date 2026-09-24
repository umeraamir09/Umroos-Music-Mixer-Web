import { ImageResponse } from "next/og";
import { SocialImage } from "@/components/social-image";

export const alt = "Umroo's Music Mixer creates Spotify playlists shaped around your taste.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(<SocialImage />, size);
}
