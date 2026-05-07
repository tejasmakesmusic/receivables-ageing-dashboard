import {
  ProgressPath,
  type ProgressStep,
} from "@/components/engagement/progress-path";

const labels: Array<Pick<ProgressStep, "id" | "label" | "description">> = [
  {
    id: "upload",
    label: "Upload",
    description: "Workbook retained with hash evidence.",
  },
  {
    id: "parse",
    label: "Parse",
    description: "Rows normalized and staged for review.",
  },
  {
    id: "review",
    label: "Review",
    description: "Warnings and duplicates are checked.",
  },
  {
    id: "resolve",
    label: "Resolve",
    description: "Aliases, FX, and parser errors are cleared.",
  },
  {
    id: "publish",
    label: "Publish",
    description: "Snapshot becomes the ageing source of truth.",
  },
  {
    id: "reconcile",
    label: "Reconcile",
    description: "Dashboard AR is matched to accounting AR.",
  },
];

function steps(
  states: ProgressStep["state"][],
  blocker?: string,
): ProgressStep[] {
  return labels.map((step, index) => ({
    ...step,
    state: states[index] ?? "not_started",
    blocker:
      states[index] === "blocked" ? blocker ?? "Resolve blocker" : undefined,
    href: states[index] === "active" ? "/snapshots" : undefined,
  }));
}

const meta = {
  title: "Workflows/ProgressPath",
  component: ProgressPath,
};

export default meta;

export function Empty() {
  return (
    <ProgressPath
      steps={steps([
        "not_started",
        "not_started",
        "not_started",
        "not_started",
        "not_started",
        "not_started",
      ])}
    />
  );
}

export function Active() {
  return (
    <ProgressPath
      steps={steps([
        "completed",
        "completed",
        "active",
        "not_started",
        "not_started",
        "not_started",
      ])}
    />
  );
}

export function Blocked() {
  return (
    <ProgressPath
      steps={steps(
        ["completed", "completed", "completed", "blocked", "not_started", "not_started"],
        "3 aliases need review before publish.",
      )}
    />
  );
}

export function Completed() {
  return (
    <ProgressPath
      steps={steps([
        "completed",
        "completed",
        "completed",
        "completed",
        "completed",
        "completed",
      ])}
    />
  );
}
