import type { ReactNode } from "react";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/topbar";
import { ToastProvider } from "@/components/ui/toast";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden bg-[var(--color-bg-subtle)] text-[var(--color-text)]">
        <a
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-[var(--radius-sm)] focus:bg-[var(--color-accent)] focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
          href="#main-content"
        >
          Skip to main content
        </a>
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Topbar />
          <main
            className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-bg)]"
            id="main-content"
            tabIndex={-1}
          >
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
