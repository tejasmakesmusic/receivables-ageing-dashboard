"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";

/**
 * PR C — minimal toast system. Floats bottom-right, auto-dismisses after
 * `duration` (default 4s), stacks multiple toasts. Three flavours:
 * success / error / info. Use `useToast()` inside any client component.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success("Mapping saved.");
 *   toast.error("Could not publish: gate not OK.");
 */

type ToastKind = "success" | "error" | "info";

interface ToastRecord {
  id: number;
  kind: ToastKind;
  message: string;
  duration: number;
}

interface ToastApi {
  success: (message: string, opts?: { duration?: number }) => void;
  error: (message: string, opts?: { duration?: number }) => void;
  info: (message: string, opts?: { duration?: number }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string, duration: number) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, kind, message, duration }]);
    },
    [],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, opts) =>
        push("success", message, opts?.duration ?? 4000),
      error: (message, opts) => push("error", message, opts?.duration ?? 6000),
      info: (message, opts) => push("info", message, opts?.duration ?? 4000),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-end gap-2 px-4 sm:right-4 sm:left-auto sm:max-w-md"
        role="status"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} record={t} onDismiss={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  record,
  onDismiss,
}: {
  record: ToastRecord;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (record.duration <= 0) return;
    const handle = window.setTimeout(onDismiss, record.duration);
    return () => window.clearTimeout(handle);
  }, [record.duration, onDismiss]);

  const tone =
    record.kind === "success"
      ? "border-[var(--color-status-current-border)] bg-[var(--color-status-current-bg)] text-[var(--color-status-current-text)]"
      : record.kind === "error"
        ? "border-[var(--color-status-danger-border)] bg-[var(--color-status-danger-bg)] text-[var(--color-status-danger-text)]"
        : "border-[var(--color-status-info-border)] bg-[var(--color-status-info-bg)] text-[var(--color-status-info-text)]";

  const Icon =
    record.kind === "success"
      ? CheckCircle2
      : record.kind === "error"
        ? XCircle
        : Info;

  return (
    <div
      className={`pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-sm shadow-md ${tone}`}
      role="alert"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1 break-words">{record.message}</p>
      <button
        aria-label="Dismiss notification"
        className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
        onClick={onDismiss}
        type="button"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Soft fallback so client components never crash if mounted outside the
    // provider — log instead, since toasts are inherently non-critical.
    return {
      success: (m) =>
         
        console.log(`[toast.success] ${m}`),
      error: (m) =>
         
        console.warn(`[toast.error] ${m}`),
      info: (m) =>
         
        console.log(`[toast.info] ${m}`),
    };
  }
  return ctx;
}
