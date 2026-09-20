import { Disc3 } from "lucide-react";
import Image from "next/image";

export function CoverArt({ src, name, className = "" }: { src?: string; name: string; className?: string }) {
  return (
    <div className={`cover-art ${className}`}>
      {src ? <Image src={src} alt={`${name} playlist cover`} fill sizes="(max-width: 650px) 86vw, 375px" unoptimized /> : <div className="cover-placeholder"><Disc3 size={42} /><span>{name}</span></div>}
    </div>
  );
}
