export interface BoardTaskInput {
  id: string;
  priority_score: number;
  reason_code: string;
  status: string;
}

export type BoardColumnId =
  | "new"
  | "reminder-sent"
  | "promise-to-pay"
  | "escalated"
  | "payment-expected"
  | "closed";

export interface BoardColumn<TTask extends BoardTaskInput = BoardTaskInput> {
  id: BoardColumnId;
  label: string;
  tasks: TTask[];
}

export function groupCollectionBoard<TTask extends BoardTaskInput>(
  tasks: TTask[],
): BoardColumn<TTask>[] {
  const columns: BoardColumn<TTask>[] = [
    { id: "new", label: "New", tasks: [] },
    { id: "reminder-sent", label: "Reminder Sent", tasks: [] },
    { id: "promise-to-pay", label: "Promise to Pay", tasks: [] },
    { id: "escalated", label: "Escalated", tasks: [] },
    { id: "payment-expected", label: "Payment Expected", tasks: [] },
    { id: "closed", label: "Closed", tasks: [] },
  ];
  const byId = new Map(columns.map((column) => [column.id, column]));

  for (const task of tasks) {
    if (task.status === "DONE" || task.status === "DISMISSED") {
      byId.get("closed")?.tasks.push(task);
    } else if (task.status === "SNOOZED") {
      byId.get("payment-expected")?.tasks.push(task);
    } else if (task.reason_code === "BROKEN_PROMISE") {
      byId.get("promise-to-pay")?.tasks.push(task);
    } else if (
      task.reason_code === "DISPUTE_OPEN" ||
      task.priority_score >= 96
    ) {
      byId.get("escalated")?.tasks.push(task);
    } else {
      byId.get("new")?.tasks.push(task);
    }
  }

  return columns;
}
