import { useCallback, useLayoutEffect, useState } from "react";

export type Theme = "light" | "dark";

// Not scoped per user: the theme is a device/browser preference, and it must
// apply before sign-in resolves (the loading screen shouldn't flash light).
const THEME_KEY = "tt_theme";

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch { /* fall through */ }
  // First run: respect the OS preference; default stays light (the app's
  // original look) when matchMedia is unavailable.
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(readTheme);

  // Layout effect so the attribute lands before paint — a plain effect would
  // flash one frame of the previous theme on toggle.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      try { localStorage.setItem(THEME_KEY, next); } catch { /* in-memory only */ }
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
