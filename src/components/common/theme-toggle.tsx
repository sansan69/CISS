"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "@phosphor-icons/react";
import { getStoredTheme, setThemePreference } from "@/lib/theme";

/**
 * Manual light/dark toggle. The app follows the OS preference by default;
 * clicking this button pins an explicit preference (persisted in
 * localStorage). Mirrors the current effective theme on mount.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    const stored = getStoredTheme();
    setDark(stored === "dark" || (stored === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    setThemePreference(next ? "dark" : "light");
  };

  if (dark === null) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.97]"
    >
      {dark ? <Sun className="h-5 w-5" weight="regular" aria-hidden="true" /> : <Moon className="h-5 w-5" weight="regular" aria-hidden="true" />}
    </button>
  );
}
