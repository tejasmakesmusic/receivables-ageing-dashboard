"use client";

import { useEffect, type CSSProperties } from "react";
import Link from "next/link";

import { captureException } from "@/lib/sentry";

type ErrorBoundaryProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

const shellStyle: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#ffffff",
  color: "#333333",
  padding: "32px",
};

const panelStyle: CSSProperties = {
  width: "100%",
  maxWidth: "440px",
  border: "1px solid #ebebeb",
  borderRadius: "8px",
  padding: "24px",
  background: "#ffffff",
};

const titleStyle: CSSProperties = {
  margin: "0 0 8px",
  fontSize: "20px",
  lineHeight: 1.3,
  fontWeight: 600,
};

const copyStyle: CSSProperties = {
  margin: "0 0 20px",
  color: "#666666",
  fontSize: "14px",
  lineHeight: 1.5,
};

const actionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
};

const buttonStyle: CSSProperties = {
  border: "1px solid #2563eb",
  borderRadius: "6px",
  background: "#2563eb",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 600,
  padding: "9px 14px",
  cursor: "pointer",
};

const linkStyle: CSSProperties = {
  color: "#2563eb",
  fontSize: "14px",
  fontWeight: 600,
  textDecoration: "none",
};

export default function Error({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <main style={shellStyle}>
      <section style={panelStyle} aria-labelledby="page-error-title">
        <h1 id="page-error-title" style={titleStyle}>
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
  );
}
