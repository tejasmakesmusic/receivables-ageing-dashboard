"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function ViewPreferenceSync({
  currentView,
  paramName = "view",
  storageKey,
  validViews,
}: {
  currentView: string;
  paramName?: string;
  storageKey: string;
  validViews: readonly string[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const currentParam = searchParams.get(paramName);

    if (currentParam) {
      window.localStorage.setItem(storageKey, currentView);
      return;
    }

    const storedView = window.localStorage.getItem(storageKey);
    if (!storedView || storedView === currentView || !validViews.includes(storedView)) {
      return;
    }

    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.set(paramName, storedView);
    const query = nextSearchParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [currentView, paramName, pathname, router, searchParams, storageKey, validViews]);

  return null;
}
