"use client";

import { useEffect, type CSSProperties } from "react";
import Link from "next/link";
import { captureException } from "@/lib/sentry";

type GlobalErrorBoundaryProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

const bodyStyle: CSSProperties = {
  margin: 0,
  minHeight: "100vh",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

const shellStyle: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "32px",
};

const panelStyle: CSSProperties = {
  width: "100%",
  maxWidth: "440px",
  border: "1px solid var(--color-border-medium)",
  borderRadius: "8px",
  padding: "24px",
  background: "var(--color-bg)",
};

const titleStyle: CSSProperties = {
  margin: "0 0 8px",
  fontSize: "20px",
  lineHeight: 1.3,
  fontWeight: 600,
};

const copyStyle: CSSProperties = {
  margin: "0 0 20px",
  color: "var(--color-text-muted)",
  fontSize: "14px",
  lineHeight: 1.5,
};

const actionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
};

const buttonStyle: CSSProperties = {
  border: "1px solid var(--color-accent)",
  borderRadius: "6px",
  background: "var(--color-accent)",
  color: "var(--color-bg)",
  fontSize: "14px",
  fontWeight: 600,
  padding: "9px 14px",
  cursor: "pointer",
};

const linkStyle: CSSProperties = {
  color: "var(--color-accent)",
  fontSize: "14px",
  fontWeight: 600,
  textDecoration: "none",
};

export default function GlobalError({
  error,
  reset,
}: GlobalErrorBoundaryProps) {
  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={bodyStyle}>
        <main style={shellStyle}>
          <section style={panelStyle} aria-labelledby="root-error-title">
            <h1 id="root-error-title" style={titleStyle}>
              Something went wrong loading this page.
            </h1>
            <p style={copyStyle}>Try again or report the issue.</p>
            <div style={actionsStyle}>
              <button type="button" onClick={reset} style={buttonStyle}>
                Try again
              </button>
              <Link href="/" style={linkStyle}>
                Back to home
              </Link>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
