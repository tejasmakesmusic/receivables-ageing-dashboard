/**
 * A2 — Email outbox + Email rules
 * Route: /admin/emails   Roles: ADMIN
 *
 * Sections:
 *  1. Email rules — 3 rows with recipients, schedule, active toggle.
 *     ADMIN sees "Edit" button; ANALYST/CFO see read-only view.
 *  2. Email outbox — existing list with mark-sent.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import type {
  EmailOutboxListResponse,
  EmailRuleListResponse,
  EmailRuleRow,
  EmailRulePatchRequest,
  EntityFilterLiteral,
} from "@/types";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { Input } from "@/components/ui/Input";
import { formatISTDateTime } from "@/lib/format";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function validateEmails(raw: string): { valid: string[]; error: string | null } {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const invalid = lines.filter((l) => !EMAIL_RE.test(l));
  if (invalid.length > 0) {
    return { valid: [], error: `Invalid email(s): ${invalid.join(", ")}` };
  }
  return { valid: lines, error: null };
}

function statusBadge(status: string) {
  const map: Record<string, "success" | "error" | "info" | "neutral"> = {
    SENT: "success",
    FAILED: "error",
    QUEUED: "info",
  };
  return <Badge variant={map[status] ?? "neutral"}>{status}</Badge>;
}

function activeBadge(active: boolean) {
  return (
    <Badge variant={active ? "success" : "muted"}>{active ? "Active" : "Inactive"}</Badge>
  );
}

// ---------------------------------------------------------------------------
// EditEmailRuleModal
// ---------------------------------------------------------------------------

interface EditEmailRuleModalProps {
  rule: EmailRuleRow;
  onClose: () => void;
  onSaved: () => void;
}

function EditEmailRuleModal({ rule, onClose, onSaved }: EditEmailRuleModalProps) {
  const qc = useQueryClient();
  const [recipientsRaw, setRecipientsRaw] = useState(rule.recipients_json.join("\n"));
  const [cronSchedule, setCronSchedule] = useState(rule.cron_schedule ?? "");
  const [isActive, setIsActive] = useState(rule.is_active);
  const [entityFilter, setEntityFilter] = useState<EntityFilterLiteral | "">(
    rule.entity_filter ?? "",
  );
  const [notes, setNotes] = useState(rule.notes ?? "");
  const [recipientError, setRecipientError] = useState<string | null>(null);

  const mutation = useMutation<EmailRuleRow, ApiError, EmailRulePatchRequest>({
    mutationFn: (body) => api.patch<EmailRuleRow>(`/admin/email-rules/${rule.id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-rules"] });
      onSaved();
      onClose();
    },
  });

  function handleSave() {
    const { valid, error } = validateEmails(recipientsRaw);
    if (error) {
      setRecipientError(error);
      return;
    }
    setRecipientError(null);

    const body: EmailRulePatchRequest = {
      recipients_json: valid,
      cron_schedule: cronSchedule || undefined,
      is_active: isActive,
      entity_filter: (entityFilter as EntityFilterLiteral) || undefined,
      notes: notes || undefined,
    };
    mutation.mutate(body);
  }

  return (
    <Modal open title={`Edit rule: ${rule.rule_type}`} onClose={onClose} size="md">
      <div className="space-y-4">
        {/* Recipients */}
        <Textarea
          label="Recipients (one email per line)"
          rows={5}
          value={recipientsRaw}
          onChange={(e) => { setRecipientsRaw(e.target.value); setRecipientError(null); }}
          placeholder="finance@emb.global&#10;cfo@emb.global"
          error={recipientError ?? undefined}
        />

        {/* Cron */}
        <Input
          label="Cron schedule (leave blank for event-driven rules)"
          value={cronSchedule}
          onChange={(e) => setCronSchedule(e.target.value)}
          placeholder="0 9 * * *"
        />

        {/* Active */}
        <div className="flex items-center gap-2">
          <input
            id="is_active"
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 accent-blue-600"
          />
          <label htmlFor="is_active" className="text-sm text-slate-700">
            Active
          </label>
        </div>

        {/* Entity filter */}
        <Select
          label="Entity filter"
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value as EntityFilterLiteral | "")}
          className="w-40"
        >
          <option value="">All entities (none)</option>
          <option value="IND">IND</option>
          <option value="UAE">UAE</option>
          <option value="ALL">ALL</option>
        </Select>

        {/* Notes */}
        <Textarea
          label="Notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional internal notes"
        />

        {mutation.isError && (
          <p className="text-xs text-red-600">
            Save failed:{" "}
            {mutation.error instanceof ApiError
              ? String(mutation.error.detail)
              : String(mutation.error)}
          </p>
        )}
      </div>

      <ModalFooter
        onClose={onClose}
        onConfirm={handleSave}
        confirmLabel="Save"
        loading={mutation.isPending}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Email rules section
// ---------------------------------------------------------------------------

function EmailRulesSection({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const [editingRule, setEditingRule] = useState<EmailRuleRow | null>(null);

  const { data, isLoading } = useQuery<EmailRuleListResponse>({
    queryKey: ["email-rules"],
    queryFn: () => api.get<EmailRuleListResponse>("/admin/email-rules"),
  });

  return (
    <div className="mb-8">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-slate-800">Email Rules</h2>
        <p className="text-xs text-slate-500">
          Controls recipients, schedule, and active flag per notification type.
          {!isAdmin && " Read-only — contact ADMIN to modify."}
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Rule type</th>
                <th className="px-3 py-2 text-left font-medium">Recipients</th>
                <th className="px-3 py-2 text-left font-medium">Cron</th>
                <th className="px-3 py-2 text-left font-medium">Entity filter</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                {isAdmin && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data?.items ?? []).map((rule) => (
                <tr key={rule.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-xs font-medium text-slate-800">
                    {rule.rule_type}
                  </td>
                  <td className="px-3 py-2 max-w-[240px]">
                    {rule.recipients_json.length === 0 ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {rule.recipients_json.slice(0, 3).map((email) => (
                          <Badge key={email} variant="info" className="text-xs">
                            {email}
                          </Badge>
                        ))}
                        {rule.recipients_json.length > 3 && (
                          <Badge variant="neutral" className="text-xs">
                            +{rule.recipients_json.length - 3} more
                          </Badge>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">
                    {rule.cron_schedule ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {rule.entity_filter ?? "All"}
                  </td>
                  <td className="px-3 py-2">{activeBadge(rule.is_active)}</td>
                  {isAdmin && (
                    <td className="px-3 py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingRule(rule)}
                      >
                        Edit
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
              {(!data?.items || data.items.length === 0) && (
                <tr>
                  <td
                    colSpan={isAdmin ? 6 : 5}
                    className="px-3 py-6 text-center text-xs text-slate-400"
                  >
                    No email rules configured
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editingRule && (
        <EditEmailRuleModal
          rule={editingRule}
          onClose={() => setEditingRule(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["email-rules"] })}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function A2EmailOutboxPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const PAGE_SIZE = 25;

  const { data: me } = useCurrentUser();
  const isAdmin = me?.role === "ADMIN";

  const params = new URLSearchParams({
    page: String(page),
    page_size: String(PAGE_SIZE),
    ...(statusFilter && { status: statusFilter }),
  });

  const { data, isLoading } = useQuery<EmailOutboxListResponse>({
    queryKey: ["email-outbox", page, statusFilter],
    queryFn: () => api.get<EmailOutboxListResponse>(`/admin/email-outbox?${params}`),
  });

  const markSent = useMutation<unknown, ApiError, string>({
    mutationFn: (id) => api.post(`/admin/email-outbox/${id}/mark-sent`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-outbox"] }),
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Email Outbox</h1>
          <p className="text-xs text-slate-500">
            SMTP send is M6-full. Mark-sent manually as needed.
          </p>
        </div>
      </div>

      {/* Email rules section */}
      <EmailRulesSection isAdmin={isAdmin} />

      {/* Divider */}
      <div className="mb-6 border-t border-gray-200" />

      {/* Outbox list */}
      <div className="mb-3">
        <h2 className="text-base font-semibold text-slate-800">Outbox Queue</h2>
      </div>

      {/* Filter */}
      <div className="mb-4">
        <Select
          label="Status"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="w-36"
        >
          <option value="">All</option>
          <option value="QUEUED">QUEUED</option>
          <option value="SENT">SENT</option>
          <option value="FAILED">FAILED</option>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Subject</th>
                <th className="px-3 py-2 text-left font-medium">Rule type</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Attempts</th>
                <th className="px-3 py-2 text-left font-medium">Enqueued</th>
                <th className="px-3 py-2 text-left font-medium">Sent at</th>
                <th className="px-3 py-2 text-left font-medium">Last error</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data?.items ?? []).map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 max-w-[200px] truncate text-xs font-medium">
                    {row.subject}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{row.rule_type}</td>
                  <td className="px-3 py-2">{statusBadge(row.status)}</td>
                  <td className="px-3 py-2 text-right text-xs">{row.attempts}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {formatISTDateTime(row.enqueued_at)}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {row.sent_at ? formatISTDateTime(row.sent_at) : "—"}
                  </td>
                  <td className="px-3 py-2 max-w-[160px] truncate text-xs text-red-500">
                    {row.last_error ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {row.status !== "SENT" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={markSent.isPending}
                        onClick={() => markSent.mutate(row.id)}
                      >
                        Mark sent
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {(!data?.items || data.items.length === 0) && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-xs text-slate-400">
                    No emails in outbox
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <Pagination page={page} totalPages={totalPages} onPage={setPage} />
      </div>
    </div>
  );
}
