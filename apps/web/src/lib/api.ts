"use client";

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string | { code?: string; message?: string; details?: unknown } };

export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const json = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as ApiOk<T> | ApiErr;
  if (!res.ok || !json.ok) {
    const msg =
      json.ok === false
        ? typeof json.error === "string"
          ? json.error
          : json.error?.message ?? `HTTP ${res.status}`
        : `HTTP ${res.status}`;
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return json.data;
}

export const get = <T = unknown>(path: string) => apiFetch<T>(path);
export const post = <T = unknown>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T = unknown>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) });
export const del = <T = unknown>(path: string) => apiFetch<T>(path, { method: "DELETE" });
