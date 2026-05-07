"use client";

import { useEffect, useState } from "react";
import {
  NudgeCard,
  nudgeSnoozeKey,
  type NudgeCardProps,
  type NudgeKind,
} from "./nudge-card";

type ClientNudge = Omit<NudgeCardProps, "onSnooze">;

type NudgeEnvelope = {
  items?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNudgeKind(value: unknown): value is NudgeKind {
  return (
    value === "ptp_due" ||
    value === "stale_followup" ||
    value === "digest_pending" ||
    value === "reconciliation_unmatched"
  );
}

function isClientNudge(value: unknown): value is ClientNudge {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isNudgeKind(value.kind) &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    typeof value.href === "string" &&
    (value.count === undefined || typeof value.count === "number")
  );
}

function payloadItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload)) {
    const envelope = payload as NudgeEnvelope;
    return Array.isArray(envelope.items) ? envelope.items : [];
  }
  return [];
}

function isUnexpiredSnooze(id: string) {
  try {
    const raw = localStorage.getItem(nudgeSnoozeKey(id));
    if (!raw) return false;

    const expiry = Number(raw);
    if (Number.isFinite(expiry) && expiry > Date.now()) {
      return true;
    }

    localStorage.removeItem(nudgeSnoozeKey(id));
    return false;
  } catch {
    return false;
  }
}

function visibleNudges(nudges: ClientNudge[]) {
  const seen = new Set<NudgeKind>();
  const visible: ClientNudge[] = [];

  for (const nudge of nudges) {
    if (seen.has(nudge.kind) || isUnexpiredSnooze(nudge.id)) {
      continue;
    }

    seen.add(nudge.kind);
    visible.push(nudge);

    if (visible.length === 4) {
      break;
    }
  }

  return visible;
}

export function NudgeStack() {
  const [nudges, setNudges] = useState<ClientNudge[]>([]);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadNudges() {
      try {
        const response = await fetch("/api/engagement/nudges", {
          signal: controller.signal,
        });

        if (response.status === 404) {
          setHidden(true);
          return;
        }

        if (!response.ok) {
          setHidden(true);
          return;
        }

        const payload = await response.json();
        const parsed = payloadItems(payload).filter(isClientNudge);
        setNudges(visibleNudges(parsed));
      } catch {
        if (!controller.signal.aborted) {
          setHidden(true);
        }
      }
    }

    void loadNudges();

    return () => controller.abort();
  }, []);

  if (hidden || nudges.length === 0) {
    return null;
  }

  return (
    <div className="space-y-[var(--spacing-2)] px-[var(--spacing-6)] py-[var(--spacing-4)]">
      {nudges.map((nudge) => (
        <NudgeCard
          key={nudge.id}
          {...nudge}
          onSnooze={(id) =>
            setNudges((current) => current.filter((item) => item.id !== id))
          }
        />
      ))}
    </div>
  );
}
