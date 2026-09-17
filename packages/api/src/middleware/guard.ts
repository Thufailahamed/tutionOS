import { createMiddleware } from "hono/factory";
import type { Permission } from "@classflow/core";
import { unauthorized, forbidden } from "../lib/http";
import type { Env } from "../env";
import type { ApiVariables } from "./session";

export const requireAuth = createMiddleware<{ Bindings: Env; Variables: ApiVariables }>(
  async (c, next) => {
    if (!c.get("user")) unauthorized();
    await next();
  },
);

export const requireMember = createMiddleware<{ Bindings: Env; Variables: ApiVariables }>(
  async (c, next) => {
    if (!c.get("user")) unauthorized();
    if (!c.get("member")) forbidden("No organization access — create or join one first");
    await next();
  },
);

export const requirePerm = (perm: Permission) =>
  createMiddleware<{ Bindings: Env; Variables: ApiVariables }>(async (c, next) => {
    if (!c.get("user")) unauthorized();
    const member = c.get("member");
    if (!member) forbidden("No organization access");
    if (!member!.permissions.has(perm)) forbidden(`Missing permission: ${perm}`);
    await next();
  });

export const requireSuperAdmin = createMiddleware<{ Bindings: Env; Variables: ApiVariables }>(
  async (c, next) => {
    const user = c.get("user");
    if (!user) return unauthorized();
    if (!user.isSuperAdmin) return forbidden("Super admin only");
    await next();
  },
);
