"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ModeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <button
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="rounded-[var(--radius-sm)] p-[var(--spacing-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] transition-colors"
      aria-label="Toggle theme"
      type="button"
    >
      {resolvedTheme === "dark" ? (
        <span aria-hidden>☀</span>
      ) : (
        <span aria-hidden>☾</span>
      )}
    </button>
  );
}
