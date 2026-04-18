import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import type { CurrentUser } from "@/types";

export function useCurrentUser() {
  return useQuery<CurrentUser, ApiError>({
    queryKey: ["me"],
    queryFn: () => api.get<CurrentUser>("/auth/me"),
    retry: (failureCount, error) => {
      // Don't retry on 401 — user is not authenticated
      if (error instanceof ApiError && error.status === 401) return false;
      return failureCount < 2;
    },
    staleTime: 60_000,
  });
}
