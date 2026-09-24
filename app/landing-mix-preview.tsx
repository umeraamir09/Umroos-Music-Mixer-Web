"use client";

import { useEffect, useState } from "react";
import styles from "./landing-mix-preview.module.css";

const prompts = [
  "Late-night R&B with familiar voices and a few new finds.",
  "An indie mix for the ride home — soft, warm, hopeful.",
];

type Frame = { index: number; length: number; direction: "typing" | "erasing" };

export function LandingMixPreview() {
  const [frame, setFrame] = useState<Frame>({ index: 0, length: 0, direction: "typing" });

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const prompt = prompts[frame.index];
    let delay: number;
    let next: Frame;

    if (frame.direction === "typing" && frame.length < prompt.length) {
      delay = 42;
      next = { ...frame, length: frame.length + 1 };
    } else if (frame.direction === "typing") {
      delay = 2300;
      next = { ...frame, direction: "erasing" };
    } else if (frame.length > 0) {
      delay = 22;
      next = { ...frame, length: frame.length - 1 };
    } else {
      delay = 440;
      next = { index: (frame.index + 1) % prompts.length, length: 0, direction: "typing" };
    }

    const timer = window.setTimeout(() => setFrame(next), delay);
    return () => window.clearTimeout(timer);
  }, [frame]);

  return (
    <div className={styles.preview} role="img" aria-label="Example playlist requests typing and erasing in a prompt field">
      <div aria-hidden="true">
        <span className={styles.label}>ASK YOUR AI MIXER</span>
        <div className={styles.input}>
          <span className={styles.typed}>{prompts[frame.index].slice(0, frame.length) || <span className={styles.placeholder}></span>}</span>
          <span className={styles.staticText}>{prompts[0]}</span>
          <span className={styles.caret} />
        </div>
      </div>
    </div>
  );
}
