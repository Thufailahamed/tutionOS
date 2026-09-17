import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";

export function ok<T>(data: T, init?: ResponseInit) {
  return Response.json({ ok: true, data }, init);
}

/** Same body as ok() but built via c.json so headers set via c.header/setCookie survive. */
export function send<T>(c: Context, data: T, init?: Parameters<Context["json"]>[1]) {
  return c.json({ ok: true, data }, init);
}

export function fail(status: number, code: string, message: string, details?: unknown): never {
  throw new HTTPException(status as 400, {
    res: Response.json({ ok: false, error: { code, message, details } }, { status }),
  });
}

export const unauthorized = (msg = "Authentication required") => fail(401, "UNAUTHORIZED", msg);
export const forbidden = (msg = "Insufficient permissions") => fail(403, "FORBIDDEN", msg);
export const notFound = (msg = "Not found") => fail(404, "NOT_FOUND", msg);
export const conflict = (msg: string) => fail(409, "CONFLICT", msg);
export const badRequest = (msg: string, details?: unknown) => fail(400, "BAD_REQUEST", msg, details);

export function parsePagination(url: string, defaultLimit = 25, maxLimit = 100) {
  const u = new URL(url);
  const page = Math.max(1, parseInt(u.searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(u.searchParams.get("limit") || String(defaultLimit), 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayColombo(): string {
  return colomboDate(new Date());
}

export function colomboDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
}
