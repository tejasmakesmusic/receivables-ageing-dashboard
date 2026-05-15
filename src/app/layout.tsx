import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { ThemeProvider } from "../../design-system/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Receivables OS",
  description: "AR control platform - EMB Global",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
