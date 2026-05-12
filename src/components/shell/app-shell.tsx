import type { ReactNode } from "react";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/topbar";
import { ToastProvider } from "@/components/ui/toast";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden bg-[var(--color-bg-subtle)] text-[var(--color-text)]">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Topbar />
          <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-bg)]">
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
