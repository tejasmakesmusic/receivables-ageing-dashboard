/**
 * API client with CSRF double-submit and session cookie auth.
 * Backend sets csrf_token (NOT httponly) + session (httponly).
 * Mutating requests mirror csrf_token in X-CSRF-Token header.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: unknown,
    originalMessage: string,
  ) {
    super(originalMessage);
    this.name = "ApiError";
  }
}

function getCsrfCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match?.[1] ?? null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const needsCsrf = method !== "GET" && method !== "HEAD";
  const csrfToken = needsCsrf ? getCsrfCookie() : null;

  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };

  if (!(init?.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
  }

  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? body, `${res.status} ${res.statusText}`);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  ApiError,
};
