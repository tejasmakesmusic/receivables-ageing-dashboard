import { GoalChip } from "@/components/engagement/goal-chip";

const meta = {
  title: "Engagement/GoalChip",
  component: GoalChip,
};

export default meta;

export function Empty() {
  return <GoalChip completed={0} target={10} />;
}

export function Partial() {
  return <GoalChip completed={4} target={10} />;
}

export function Complete() {
  return <GoalChip completed={10} target={10} />;
}

export function Above() {
  return <GoalChip completed={13} target={10} />;
}
