import type { ReactNode } from "react";
import { StreakBadge } from "@/components/engagement/streak-badge";

function mockStreak(payload: unknown, status = 200) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
      status,
    });
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="min-h-10">{children}</div>;
}

const meta = {
  title: "Engagement/StreakBadge",
  component: StreakBadge,
};

export default meta;

export function Default() {
  mockStreak({ current_streak: 7, freeze_today: false });
  return (
    <Frame>
      <StreakBadge />
    </Frame>
  );
}

export function Frozen() {
  mockStreak({ current_streak: 7, freeze_today: true });
  return (
    <Frame>
      <StreakBadge />
    </Frame>
  );
}

export function NoStreak() {
  mockStreak({}, 404);
  return (
    <Frame>
      <StreakBadge />
    </Frame>
  );
}
