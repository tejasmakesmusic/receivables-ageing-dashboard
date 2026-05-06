import * as React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { Badge } from "@/components/ui/badge";
import { getStatusTag } from "@/components/ui/status-tag-map";

const cn = (...inputs: Array<string | false | null | undefined>) =>
  twMerge(clsx(inputs));

type StatusTagProps = Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> & {
  label?: string;
  status: string | null | undefined;
};

export function StatusTag({
  className,
  label,
  status,
  ...props
}: StatusTagProps) {
  const tag = getStatusTag(status);

  return (
    <Badge
      className={cn("whitespace-nowrap", tag.className, className)}
      variant="secondary"
      {...props}
    >
      {label ?? tag.label}
    </Badge>
  );
}
