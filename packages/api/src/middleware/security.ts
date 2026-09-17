import { createMiddleware } from "hono/factory";
import type { Env } from "../env";

/** Secure headers on all API responses. */
export const securityHeaders = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (c.env.ENVIRONMENT === "production") {
    c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
});
