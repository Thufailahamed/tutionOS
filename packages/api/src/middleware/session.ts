import { createMiddleware } from "hono/factory";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { eq, and, isNull, gt } from "drizzle-orm";
import { createDb, authSessions, users, organizationMembers } from "@classflow/db";
import { effectivePermissions, type OrgRole } from "@classflow/core";
import { sha256 } from "../lib/crypto";
import { nowIso } from "../lib/http";
import type { Env } from "../env";

export const SESSION_COOKIE = "cf_session";
export const ORG_COOKIE = "cf_org";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export interface SessionUser {
  id: string;
  email: string | null;
  phone: string | null;
  fullName: string;
  isSuperAdmin: boolean;
}

export interface MemberContext {
  orgId: string;
  memberId: string;
  role: OrgRole;
  permissions: Set<string>;
}

export type ApiVariables = {
  user: SessionUser | null;
  sessionId: string | null;
  member: MemberContext | null;
  db: ReturnType<typeof createDb>;
};

export function cookieOpts(env: Env) {
  return {
    httpOnly: true,
    secure: env.ENVIRONMENT === "production",
    sameSite: "Lax" as const,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

/** Attaches db + authenticated user (if session cookie is valid). Never rejects. */
export const sessionMiddleware = createMiddleware<{ Bindings: Env; Variables: ApiVariables }>(
  async (c, next) => {
    const db = createDb(c.env.DB);
    c.set("db", db);
    c.set("user", null);
    c.set("sessionId", null);
    c.set("member", null);

    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const tokenHash = await sha256(token);
      const rows = await db
        .select({ session: authSessions, user: users })
        .from(authSessions)
        .innerJoin(users, eq(authSessions.userId, users.id))
        .where(
          and(
            eq(authSessions.tokenHash, tokenHash),
            isNull(authSessions.revokedAt),
            gt(authSessions.expiresAt, nowIso()),
            eq(users.status, "active"),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (row) {
        c.set("user", {
          id: row.user.id,
          email: row.user.email,
          phone: row.user.phone,
          fullName: row.user.fullName,
          isSuperAdmin: row.user.isSuperAdmin,
        });
        c.set("sessionId", row.session.id);
        db.update(authSessions)
          .set({ lastSeenAt: nowIso() })
          .where(eq(authSessions.id, row.session.id))
          .run()
          .catch(() => {});
      }
    }

    // Resolve tenant membership once user is known
    const user = c.get("user");
    if (user) {
      const requestedOrg =
        c.req.header("x-org-id") || getCookie(c, ORG_COOKIE) || undefined;
      const memberships = await db
        .select()
        .from(organizationMembers)
        .where(and(eq(organizationMembers.userId, user.id), eq(organizationMembers.status, "active")));
      const chosen =
        memberships.find((m) => m.orgId === requestedOrg) ?? memberships[0];
      if (chosen) {
        const grants: string[] = JSON.parse(chosen.grantsJson || "[]");
        const revokes: string[] = JSON.parse(chosen.revokesJson || "[]");
        c.set("member", {
          orgId: chosen.orgId,
          memberId: chosen.id,
          role: chosen.role as OrgRole,
          permissions: effectivePermissions(chosen.role as OrgRole, grants, revokes),
        });
        if (chosen.orgId !== requestedOrg) {
          setCookie(c, ORG_COOKIE, chosen.orgId, cookieOpts(c.env));
        }
      }
    }
    await next();
  },
);

export { setCookie, deleteCookie, getCookie };
