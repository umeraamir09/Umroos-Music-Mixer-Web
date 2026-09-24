"use client";

import { Disc3 } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

export function TrackArtwork({ src }: { src?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  return <span className="track-artwork" aria-hidden="true">
    {src && src !== failedSrc
      ? <Image src={src} alt="" fill sizes="48px" unoptimized onError={() => setFailedSrc(src)} />
      : <Disc3 size={22} strokeWidth={1.2} />}
  </span>;
}
