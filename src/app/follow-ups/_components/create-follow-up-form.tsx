"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type FollowUpTarget = "party" | "invoice";

type CreateFollowUpFormProps = {
  defaultCanonicalId?: string;
  defaultInvoiceId?: string;
};

export default function CreateFollowUpForm({
  defaultCanonicalId = "",
  defaultInvoiceId = "",
}: CreateFollowUpFormProps) {
  const router = useRouter();
  const [target, setTarget] = useState<FollowUpTarget>("party");
  const [canonicalId, setCanonicalId] = useState(defaultCanonicalId);
  const [invoiceId, setInvoiceId] = useState(defaultInvoiceId);
  const [contactPerson, setContactPerson] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [nextActionDate, setNextActionDate] = useState("");
  const [channel, setChannel] = useState("EMAIL");
  const [feedback, setFeedback] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setFeedback("");

    const normalize = (value: string): string | null =>
      value.trim() === "" ? null : value.trim();

    const normalizedCanonical = normalize(canonicalId);
    const normalizedInvoice = normalize(invoiceId);
    const endpoint =
      target === "invoice" && normalizedInvoice
        ? `/api/invoices/${encodeURIComponent(normalizedInvoice)}/follow-ups`
        : normalizedCanonical
          ? `/api/parties/${encodeURIComponent(normalizedCanonical)}/follow-ups`
          : "";

    if (!endpoint) {
      setFeedback("Please provide a target canonical id or invoice id.");
      setIsSubmitting(false);
      return;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date,
        channel,
        contact_person: normalize(contactPerson),
        next_action_date: normalize(nextActionDate),
        notes: normalize(notes),
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        detail?: string;
        message?: string;
      } | null;
      setFeedback(
        typeof payload?.detail === "string"
          ? payload.detail
          : typeof payload?.message === "string"
            ? payload.message
            : "Failed to create follow-up.",
      );
      setIsSubmitting(false);
      return;
    }

    setFeedback("Follow-up created.");
    setCanonicalId("");
    setInvoiceId("");
    setContactPerson("");
    setNotes("");
    setDate(new Date().toISOString().slice(0, 10));
    setNextActionDate("");
    setIsSubmitting(false);
    router.refresh();
  }

  return (
    <section className="card-grid">
      <form
        className="rounded-lg border border-slate-200 bg-white p-4"
        onSubmit={handleSubmit}
      >
        <h2 className="mb-3 text-sm font-semibold">Create Follow-Up</h2>

        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-medium">
            Target
            <select
              className="mt-1 block w-full rounded border border-slate-200 px-2 py-2 text-sm"
              value={target}
              onChange={(event) =>
                setTarget(event.target.value as FollowUpTarget)
              }
            >
              <option value="party">Party</option>
              <option value="invoice">Invoice</option>
            </select>
          </label>

          {target === "party" ? (
            <label className="text-xs font-medium">
              Canonical ID
              <input
                className="mt-1 block w-full rounded border border-slate-200 px-2 py-2 text-sm"
                name="canonical_id"
                value={canonicalId}
                onChange={(event) => setCanonicalId(event.target.value)}
                placeholder="UUID"
              />
            </label>
          ) : (
            <label className="text-xs font-medium">
              Invoice ID
              <input
                className="mt-1 block w-full rounded border border-slate-200 px-2 py-2 text-sm"
                name="invoice_id"
                value={invoiceId}
                onChange={(event) => setInvoiceId(event.target.value)}
                placeholder="UUID"
              />
            </label>
          )}

          <label className="text-xs font-medium">
            Date
            <input
              required
              className="mt-1 block w-full rounded border border-slate-200 px-2 py-2 text-sm"
              name="date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>

          <label className="text-xs font-medium">
            Channel
            <select
              className="mt-1 block w-full rounded border border-slate-200 px-2 py-2 text-sm"
              value={channel}
              onChange={(event) => setChannel(event.target.value)}
            >
              <option value="EMAIL">EMAIL</option>
              <option value="CALL">CALL</option>
              <option value="WHATSAPP">WHATSAPP</option>
              <option value="MEETING">MEETING</option>
            </select>
          </label>

          <label className="text-xs font-medium">
            Contact Person
            <input
              className="mt-1 block w-full rounded border border-slate-200 px-2 py-2 text-sm"
              value={contactPerson}
              onChange={(event) => setContactPerson(event.target.value)}
              placeholder="Optional"
            />
          </label>

          <label className="text-xs font-medium">
            Next Action Date
            <input
              className="mt-1 block w-full rounded border border-slate-200 px-2 py-2 text-sm"
              type="date"
              value={nextActionDate}
              onChange={(event) => setNextActionDate(event.target.value)}
            />
          </label>
        </div>

        <label className="mb-3 block text-xs font-medium">
          Notes
          <textarea
            className="mt-1 block w-full rounded border border-slate-200 px-2 py-2 text-sm"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional"
          />
        </label>

        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? "Saving..." : "Create"}
        </Button>

        {feedback ? (
          <p className="mt-2 text-sm text-slate-600">{feedback}</p>
        ) : null}
      </form>
    </section>
  );
}
