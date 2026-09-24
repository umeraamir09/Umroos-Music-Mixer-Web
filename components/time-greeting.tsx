"use client";

import { useEffect, useState } from "react";

type Period = "morning" | "afternoon" | "evening" | "lateNight";
type Greeting = { lead: string; accent: string };

const greetings: Record<Period, Greeting[]> = {
  morning: [
    { lead: "Good", accent: "morning." },
    { lead: "A fresh", accent: "start." },
    { lead: "Wake up", accent: "to music." },
  ],
  afternoon: [
    { lead: "Afternoon", accent: "chill?" },
    { lead: "Find your", accent: "flow." },
    { lead: "Midday", accent: "mood." },
  ],
  evening: [
    { lead: "Tonight", accent: "your way." },
    { lead: "Ease into", accent: "evening." },
    { lead: "Evening", accent: "edit." },
  ],
  lateNight: [
    { lead: "Late night", accent: "music?" },
    { lead: "One more", accent: "song?" },
    { lead: "Stay up", accent: "for music." },
  ],
};

function periodForHour(hour: number): Period {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "lateNight";
}

function chooseGreeting(period: Period): Greeting {
  const options = greetings[period];
  const key = `umm_last_greeting_${period}`;
  let last: string | null = null;
  try { last = window.sessionStorage.getItem(key); } catch { /* Browsing storage may be unavailable. */ }
  let index = Math.floor(Math.random() * options.length);
  if (last !== null && index === Number(last)) index = (index + 1) % options.length;
  try { window.sessionStorage.setItem(key, String(index)); } catch { /* The greeting still works without storage. */ }
  return options[index];
}

export function TimeGreeting() {
  const [greeting, setGreeting] = useState<Greeting | null>(null);

  useEffect(() => {
    let period = periodForHour(new Date().getHours());
    const initial = window.setTimeout(() => setGreeting(chooseGreeting(period)), 0);
    const interval = window.setInterval(() => {
      const current = periodForHour(new Date().getHours());
      if (current !== period) {
        period = current;
        setGreeting(chooseGreeting(period));
      }
    }, 60_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, []);

  return (
    <h1 className="prompt-greeting" aria-live="polite">
      {greeting ? <><span>{greeting.lead}</span><em>{greeting.accent}</em></> : <span className="sr-only">Your next mix</span>}
    </h1>
  );
}
