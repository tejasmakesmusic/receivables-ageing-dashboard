"use client";

import { useMemo, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { StatusTag } from "@/components/ui/status-tag";
import type { dispute_case_status } from "@/generated/prisma/enums";

type DisputeKanbanProps = {
  disputes: Array<{
    id: string;
    canonical_id: string;
    party_name: string;
    entity_code: string;
    reason_code: string;
    status: dispute_case_status;
  }>;
};

type DisputeCard = DisputeKanbanProps["disputes"][number];

const COLUMNS: Array<{ label: string; status: dispute_case_status }> = [
  { label: "Open", status: "OPEN" },
  { label: "Investigating", status: "IN_REVIEW" },
  { label: "Escalated", status: "WAITING_ON_CUSTOMER" },
  { label: "Resolved", status: "RESOLVED" },
  { label: "Closed", status: "CLOSED" },
];

const TRANSITIONS: Record<dispute_case_status, dispute_case_status[]> = {
  OPEN: ["IN_REVIEW", "CLOSED"],
  IN_REVIEW: ["WAITING_ON_CUSTOMER", "RESOLVED", "CLOSED"],
  WAITING_ON_CUSTOMER: ["IN_REVIEW", "RESOLVED", "CLOSED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

export function validNextStates(
  status: dispute_case_status,
): dispute_case_status[] {
  return TRANSITIONS[status];
}

function statusTag(status: dispute_case_status) {
  return `DISPUTE_${status}`;
}

function canDropOn(
  card: DisputeCard | undefined,
  status: dispute_case_status,
) {
  if (!card) return true;
  return card.status === status || validNextStates(card.status).includes(status);
}

export function DisputeKanban({ disputes }: DisputeKanbanProps) {
  const router = useRouter();
  const [statusOverrides, setStatusOverrides] = useState<
    Partial<Record<string, dispute_case_status>>
  >({});
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cards = useMemo(
    () =>
      disputes.map((card) => ({
        ...card,
        status: statusOverrides[card.id] ?? card.status,
      })),
    [disputes, statusOverrides],
  );

  const draggedCard = useMemo(
    () => cards.find((card) => card.id === draggedId),
    [cards, draggedId],
  );

  const cardsByStatus = useMemo(() => {
    const grouped = COLUMNS.reduce(
      (acc, column) => {
        acc[column.status] = [];
        return acc;
      },
      {} as Record<dispute_case_status, DisputeCard[]>,
    );

    for (const card of cards) {
      grouped[card.status].push(card);
    }

    return grouped;
  }, [cards]);

  function onDragStart(
    event: DragEvent<HTMLDivElement>,
    dispute: DisputeCard,
  ) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dispute.id);
    setDraggedId(dispute.id);
    setError(null);
  }

  function onDragOver(
    event: DragEvent<HTMLDivElement>,
    targetStatus: dispute_case_status,
  ) {
    if (canDropOn(draggedCard, targetStatus)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
  }

  async function onDrop(targetStatus: dispute_case_status) {
    const dispute = draggedCard;
    setDraggedId(null);

    if (!dispute || dispute.status === targetStatus) return;
    if (!validNextStates(dispute.status).includes(targetStatus)) return;

    const baseStatus = disputes.find((card) => card.id === dispute.id)?.status;
    setStatusOverrides((current) => ({
      ...current,
      [dispute.id]: targetStatus,
    }));

    try {
      const response = await fetch(`/api/disputes/${dispute.id}`, {
        body: JSON.stringify({ status: targetStatus }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });

      if (!response.ok) {
        throw new Error("Invalid transition");
      }

      router.refresh();
    } catch {
      setStatusOverrides((current) => {
        const next = { ...current };
        if (baseStatus === dispute.status) {
          delete next[dispute.id];
        } else {
          next[dispute.id] = dispute.status;
        }
        return next;
      });
      setError("Couldn't move (state machine rejected)");
    }
  }

  return (
    <div className="space-y-3 p-4">
      {error ? (
        <div className="rounded-[var(--radius-sm)] border border-[var(--color-status-danger-border)] bg-[var(--color-status-danger-bg)] px-3 py-2 text-sm font-medium text-[var(--color-status-danger-text)]">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-5">
        {COLUMNS.map((column) => {
          const disabled = draggedCard ? !canDropOn(draggedCard, column.status) : false;
          const columnCards = cardsByStatus[column.status];

          return (
            <div
              className={[
                "min-h-[360px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] transition-opacity",
                disabled ? "pointer-events-none opacity-40" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={column.status}
              onDragOver={(event) => onDragOver(event, column.status)}
              onDrop={() => onDrop(column.status)}
            >
              <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-3 py-2">
                <h2 className="text-sm font-semibold text-[var(--color-text)]">
                  {column.label}
                </h2>
                <span className="rounded-[var(--radius-pill)] bg-[var(--color-surface)] px-2 py-0.5 text-xs font-semibold text-[var(--color-text-muted)]">
                  {columnCards.length}
                </span>
              </div>

              <div className="space-y-2 p-2">
                {columnCards.length ? (
                  columnCards.map((dispute) => (
                    <div
                      className="cursor-grab rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm transition hover:border-[var(--color-border-strong)] active:cursor-grabbing"
                      draggable
                      key={dispute.id}
                      onDragEnd={() => setDraggedId(null)}
                      onDragStart={(event) => onDragStart(event, dispute)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[var(--color-text)]">
                            {dispute.party_name}
                          </div>
                          <div className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
                            {dispute.reason_code}
                          </div>
                        </div>
                        <Badge variant="secondary">{dispute.entity_code}</Badge>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-[11px] text-[var(--color-text-subtle)]">
                          {dispute.canonical_id}
                        </span>
                        <StatusTag status={statusTag(dispute.status)} />
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-8 text-center text-sm text-[var(--color-text-muted)]">
                    No cases
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
