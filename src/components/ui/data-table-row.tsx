"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

export function DataTableRow({
  children,
  className,
  dataRowKey,
  createHref,
  editHref,
  href,
}: {
  children: ReactNode;
  className?: string;
  createHref?: string;
  dataRowKey: string;
  editHref?: string;
  href?: string;
}) {
  const router = useRouter();
  const interactive = Boolean(href);

  function pushHref(targetHref: string | undefined) {
    if (targetHref) {
      router.push(targetHref);
    }
  }

  return (
    <tr
      className={className}
      data-row-key={dataRowKey}
      onKeyDown={
        href
          ? (event) => {
              if ((event.target as HTMLElement).closest("a, button")) return;
              if (event.key === "Enter") {
                event.preventDefault();
                pushHref(href);
              }
              if (event.key === "Escape") {
                event.currentTarget.blur();
              }
              if (event.key.toLowerCase() === "e") {
                event.preventDefault();
                pushHref(editHref ?? href);
              }
              if (event.key.toLowerCase() === "c" && createHref) {
                event.preventDefault();
                pushHref(createHref);
              }
            }
          : undefined
      }
      onClick={
        href
          ? (e) => {
              if ((e.target as HTMLElement).closest("a, button")) return;
              router.push(href);
            }
          : undefined
      }
      data-create-href={createHref}
      data-edit-href={editHref}
      tabIndex={interactive ? 0 : undefined}
    >
      {children}
    </tr>
  );
}
