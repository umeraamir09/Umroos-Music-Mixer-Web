import { Disc3 } from "lucide-react";
import Image from "next/image";

export function CoverArt({ src, name, className = "" }: { src?: string; name: string; className?: string }) {
  return (
    <div className={`cover-art ${className}`}>
      {src ? <Image src={src} alt={`${name} playlist cover`} fill sizes="(max-width: 650px) 86vw, 375px" unoptimized /> : <div className="cover-placeholder"><span className="cover-edition">UMROO&apos;S / MIX 001</span><Disc3 size={76} strokeWidth={.9} aria-hidden="true" /><span className="cover-name">{name}</span><span className="cover-footer">YOUR MUSIC, REIMAGINED</span></div>}
    </div>
  );
}
