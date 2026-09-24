"use client";

import type { PointerEvent } from "react";
import { CoverArt } from "@/components/cover-art";

export function InteractiveCoverArt({ src, name }: { src?: string; name: string }) {
  function move(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return;
    const cover = event.currentTarget;
    const bounds = cover.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    cover.style.setProperty("--cover-tilt-x", `${((.5 - y) * 8).toFixed(2)}deg`);
    cover.style.setProperty("--cover-tilt-y", `${((x - .5) * 8).toFixed(2)}deg`);
    cover.style.setProperty("--cover-pointer-x", `${(x * 100).toFixed(1)}%`);
    cover.style.setProperty("--cover-pointer-y", `${(y * 100).toFixed(1)}%`);
  }

  function reset(event: PointerEvent<HTMLDivElement>) {
    const cover = event.currentTarget;
    cover.style.setProperty("--cover-tilt-x", "0deg");
    cover.style.setProperty("--cover-tilt-y", "0deg");
    cover.style.setProperty("--cover-pointer-x", "50%");
    cover.style.setProperty("--cover-pointer-y", "50%");
  }

  return <div className="result-cover-interactive" onPointerMove={move} onPointerLeave={reset} onPointerCancel={reset}>
    <CoverArt src={src} name={name} className="result-cover" />
  </div>;
}
