"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";

const CURRENCIES = ["AED", "INR", "USD", "EUR", "GBP"];

type ImportResponse = {
  status?: "created" | "already_exists";
  message?: string;
  fx_rate?: {
    rate: string;
    valid_from: string;
  } | null;
};

export function FxRateImportForm() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState("AED");
  const [to, setTo] = useState("INR");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (from === to) {
      toast.error("from_ccy and to_ccy must differ");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/config/fx-rates/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_ccy: from,
          to_ccy: to,
          date,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | ImportResponse
        | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? `Import failed (${response.status})`);
      }

      if (payload?.status === "already_exists") {
        toast.info(`FX rate already exists for ${date}.`);
      } else {
        toast.success(
          `Imported ${from}->${to} ${payload?.fx_rate?.rate ?? ""} for ${date}.`,
        );
      }
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
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
            onChange={(event) => setFrom(event.target.value)}
            value={from}
          >
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
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
            onChange={(event) => setTo(event.target.value)}
            value={to}
          >
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">
          Historical date
        </span>
        <input
          className="mt-1 block h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
          disabled={busy}
          onChange={(event) => setDate(event.target.value)}
          required
          type="date"
          value={date}
        />
      </label>
      <p className="text-xs text-[var(--color-text-muted)]">
        Imports the provider rate as an immutable API-sourced row. Existing rows
        for the same pair and date are left unchanged.
      </p>
      <div className="flex justify-end">
        <button
          className="inline-flex h-9 items-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white hover:bg-[var(--color-accent-strong)] disabled:opacity-50"
          disabled={busy}
          type="submit"
        >
          {busy ? "Importing..." : "Import API rate"}
        </button>
      </div>
    </form>
  );
}
