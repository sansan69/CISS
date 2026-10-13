// Theme preference helpers for the manual light/dark override.
// The root layout applies the stored preference before first paint (inline
// script in src/app/layout.tsx); these helpers keep the UI in sync afterwards.

export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "ciss-theme";

export function getStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    // localStorage unavailable (privacy mode) — fall back to system
  }
  return "system";
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Apply a preference to <html> immediately (class + data-theme + color-scheme). */
export function applyTheme(preference: ThemePreference): void {
  if (typeof document === "undefined") return;
  const dark = preference === "dark" || (preference === "system" && systemPrefersDark());
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.dataset.theme = dark ? "dark" : "light";
  root.style.colorScheme = dark ? "dark" : "light";
}

/** Persist and apply a preference. */
export function setThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // ignore storage failures — the in-memory apply still works
  }
  applyTheme(preference);
}
