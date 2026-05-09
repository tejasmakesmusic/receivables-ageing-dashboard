"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

export function DataTableRow({
  children,
  className,
  dataRowKey,
  href,
}: {
  children: ReactNode;
  className?: string;
  dataRowKey: string;
  href?: string;
}) {
  const router = useRouter();
  return (
    <tr
      className={className}
      data-row-key={dataRowKey}
      onClick={
        href
          ? (e) => {
              if ((e.target as HTMLElement).closest("a, button")) return;
              router.push(href);
            }
          : undefined
      }
    >
      {children}
    </tr>
  );
}
