"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

const THEME_STORAGE_KEY = "umroos-app-theme";

type AppTheme = "light" | "dark";

function applyTheme(theme: AppTheme) {
  document.documentElement.dataset.appTheme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<AppTheme>("light");

  useEffect(() => {
    let savedTheme: string | null = null;
    try {
      savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Keep the in-memory theme available when storage is disabled.
    }
    const initialTheme: AppTheme = savedTheme === "dark" ? "dark" : "light";
    setTheme(initialTheme);
    applyTheme(initialTheme);

    function syncTheme(event: StorageEvent) {
      if (event.key !== THEME_STORAGE_KEY) return;
      const nextTheme: AppTheme = event.newValue === "dark" ? "dark" : "light";
      setTheme(nextTheme);
      applyTheme(nextTheme);
    }

    window.addEventListener("storage", syncTheme);
    return () => window.removeEventListener("storage", syncTheme);
  }, []);

  function toggleTheme() {
    const nextTheme: AppTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // The theme still applies for the current page when storage is disabled.
    }
  }

  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={`Switch to ${nextTheme} mode`}
      aria-pressed={theme === "dark"}
      title={`Switch to ${nextTheme} mode`}
    >
      {theme === "dark" ? <Sun size={18} strokeWidth={1.8} aria-hidden="true" /> : <Moon size={18} strokeWidth={1.8} aria-hidden="true" />}
    </button>
  );
}
