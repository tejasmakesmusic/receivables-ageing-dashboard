/**
 * Thin fetch wrapper. Real auth interceptor + error surface lands in M1
 * alongside Google SSO. For now, just a typed fetch for the /health probe.
 */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${path}`);
  }
  return res.json() as Promise<T>;
}

export const api = { request };
