import { cn } from "@/lib/utils";
import { ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const sizeMap = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-2xl" };

export function Modal({ open, onClose, title, children, className, size = "md" }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* panel */}
      <div
        className={cn(
          "relative z-10 w-full rounded-lg border border-gray-200 bg-white p-5 shadow-xl",
          sizeMap[size],
          className,
        )}
      >
        {title && (
          <div className="mb-4 flex items-start justify-between">
            <h2 className="text-base font-semibold text-slate-800">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="ml-4 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ModalFooter({
  onClose,
  onConfirm,
  confirmLabel = "Save",
  loading,
  destructive,
}: {
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  loading?: boolean;
  destructive?: boolean;
}) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <Button variant="secondary" size="sm" onClick={onClose}>
        Cancel
      </Button>
      {onConfirm && (
        <Button
          variant={destructive ? "destructive" : "primary"}
          size="sm"
          loading={loading}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      )}
    </div>
  );
}
