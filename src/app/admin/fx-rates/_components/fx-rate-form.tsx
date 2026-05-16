"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";

const CURRENCIES = ["INR", "AED", "USD", "EUR", "GBP"];

export function FxRateForm() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState("AED");
  const [to, setTo] = useState("INR");
  const [rate, setRate] = useState("");
  const [validFrom, setValidFrom] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (from === to) {
      toast.error("from_ccy and to_ccy must differ");
      return;
    }
    const rateNum = Number(rate);
    if (!Number.isFinite(rateNum) || rateNum <= 0) {
      toast.error("Rate must be a positive number");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/config/fx-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_ccy: from,
          to_ccy: to,
          rate: rateNum,
          valid_from: validFrom,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { message?: string }
        | null;
      if (!res.ok) {
        throw new Error(payload?.message ?? `Create failed (${res.status})`);
      }
      toast.success(`FX rate ${from}→${to} saved.`);
      setRate("");
      setNotes("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3 p-4" onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-[var(--color-text-muted)]">
            From currency
          </span>
          <select
            className="mt-1 block h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
            disabled={busy}
            onChange={(e) => setFrom(e.target.value)}
            value={from}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-[var(--color-text-muted)]">
            To currency
          </span>
          <select
            className="mt-1 block h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
            disabled={busy}
            onChange={(e) => setTo(e.target.value)}
            value={to}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">
          Rate (1 {from} = ? {to})
        </span>
        <input
          className="mt-1 block h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm font-mono"
          disabled={busy}
          inputMode="decimal"
          onChange={(e) => setRate(e.target.value)}
          placeholder="22.65"
          required
          value={rate}
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">
          Valid from (YYYY-MM-DD)
        </span>
        <input
          className="mt-1 block h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
          disabled={busy}
          onChange={(e) => setValidFrom(e.target.value)}
          required
          type="date"
          value={validFrom}
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">
          Notes (optional)
        </span>
        <input
          className="mt-1 block h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
          disabled={busy}
          onChange={(e) => setNotes(e.target.value)}
          value={notes}
        />
      </label>
      <p className="text-xs text-[var(--color-text-muted)]">
        FX rates are immutable. Once saved, this row cannot be edited or
        deleted — record a new row to supersede.
      </p>
      <div className="flex justify-end">
        <button
          className="inline-flex h-9 items-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white hover:bg-[var(--color-accent-strong)] disabled:opacity-50"
          disabled={busy}
          type="submit"
        >
          {busy ? "Saving…" : "Add FX rate"}
        </button>
      </div>
    </form>
  );
}
