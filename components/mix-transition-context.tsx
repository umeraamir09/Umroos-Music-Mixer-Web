"use client";

import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import type { MixRecord } from "@/lib/types";

type MixTransitionContextValue = {
  prepareMix: (mix: MixRecord) => void;
  getPreparedMix: (id: string) => MixRecord | null;
  clearPreparedMix: (id: string) => void;
};

const MixTransitionContext = createContext<MixTransitionContextValue | null>(null);

export function MixTransitionProvider({ children }: { children: React.ReactNode }) {
  const preparedMix = useRef<MixRecord | null>(null);
  const prepareMix = useCallback((mix: MixRecord) => { preparedMix.current = mix; }, []);
  const getPreparedMix = useCallback((id: string) => preparedMix.current?.id === id ? preparedMix.current : null, []);
  const clearPreparedMix = useCallback((id: string) => {
    if (preparedMix.current?.id === id) preparedMix.current = null;
  }, []);
  const value = useMemo(() => ({ prepareMix, getPreparedMix, clearPreparedMix }), [prepareMix, getPreparedMix, clearPreparedMix]);

  return <MixTransitionContext.Provider value={value}>{children}</MixTransitionContext.Provider>;
}

export function useMixTransition() {
  const context = useContext(MixTransitionContext);
  if (!context) throw new Error("MixTransitionProvider is missing.");
  return context;
}
