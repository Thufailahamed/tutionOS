import { createMiddleware } from "hono/factory";
import { fail } from "../lib/http";
import type { Env } from "../env";

/**
 * KV-backed fixed-window rate limiter. Keyed by name + caller key (ip or identifier).
 * Fails open if KV is unavailable so dev without KV still works.
 */
export function rateLimit(opts: { name: string; limit: number; windowSeconds: number }) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const ip =
      c.req.header("cf-connecting-ip") ||
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      "local";
    const key = `rl:${opts.name}:${ip}`;
    try {
      const current = await c.env.KV.get(key);
      const count = current ? parseInt(current, 10) : 0;
      if (count >= opts.limit) {
        fail(429, "RATE_LIMITED", "Too many attempts — please try again later");
      }
      await c.env.KV.put(key, String(count + 1), { expirationTtl: opts.windowSeconds });
    } catch (e) {
      if (e instanceof Response) throw e;
      // KV unavailable — allow in dev
    }
    await next();
  });
}
