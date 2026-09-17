import { Hono } from "hono";
import { eq, and, gt } from "drizzle-orm";
import {
  users,
  authSessions,
  organizations,
  organizationMembers,
} from "@classflow/db";
import { registerSchema, loginSchema } from "@classflow/core";
import { z } from "zod";
import type { Env } from "../env";
import type { ApiVariables } from "../middleware/session";
import {
  registerUser,
  loginUser,
  createSession,
  createOrgForUser,
  createOtp,
  verifyOtp,
  ensureDefaultPlans,
} from "../services/auth";
import {
  SESSION_COOKIE,
  ORG_COOKIE,
  cookieOpts,
  setCookie,
  deleteCookie,
  getCookie,
} from "../middleware/session";
import { requireAuth } from "../middleware/guard";
import { rateLimit } from "../middleware/rateLimit";
import { hashPassword, sha256 } from "../lib/crypto";
import { ok, unauthorized, badRequest, notFound, nowIso } from "../lib/http";
import { audit } from "../lib/audit";
import { dispatchChannel } from "../services/notify";

export const authRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

const DEV_OTP_EXPOSE = (env: Env) => env.ENVIRONMENT !== "production";

authRoutes.post("/register", rateLimit({ name: "register", limit: 10, windowSeconds: 600 }), async (c) => {
  const db = c.get("db");
  const body = registerSchema.parse(await c.req.json());
  const userId = await registerUser(db, body);
  // Every registration creates an organization: institute if named, else teacher-only mode
  const orgName = body.orgName?.trim() || `${body.fullName.trim()}'s Classes`;
  const orgType = body.orgType ?? (body.orgName ? "institute" : "individual");
  const orgId = await createOrgForUser(db, userId, orgName, orgType);
  const { token } = await createSession(db, userId, {
    userAgent: c.req.header("user-agent"),
    ip: c.req.header("cf-connecting-ip"),
  });
  setCookie(c, SESSION_COOKIE, token, cookieOpts(c.env));
  setCookie(c, ORG_COOKIE, orgId, cookieOpts(c.env));
  await audit(db, { orgId, actorUserId: userId, action: "ORGANIZATION_CREATED", entity: "organization", entityId: orgId });
  return ok({ userId, orgId }, { status: 201 });
});

authRoutes.post("/login", rateLimit({ name: "login", limit: 8, windowSeconds: 300 }), async (c) => {
  const db = c.get("db");
  const body = loginSchema.parse(await c.req.json());
  const user = await loginUser(db, body.identifier, body.password);
  const { token } = await createSession(db, user.id, {
    userAgent: c.req.header("user-agent"),
    ip: c.req.header("cf-connecting-ip"),
  });
  setCookie(c, SESSION_COOKIE, token, cookieOpts(c.env));
  return ok({ userId: user.id });
});

authRoutes.post("/logout", async (c) => {
  const db = c.get("db");
  const sessionId = c.get("sessionId");
  if (sessionId) {
    await db.update(authSessions).set({ revokedAt: nowIso() }).where(eq(authSessions.id, sessionId));
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return ok({ loggedOut: true });
});

authRoutes.get("/me", async (c) => {
  const user = c.get("user");
  if (!user) return ok({ user: null, memberships: [], activeOrgId: null });
  const db = c.get("db");
  const memberships = await db
    .select({
      memberId: organizationMembers.id,
      orgId: organizationMembers.orgId,
      role: organizationMembers.role,
      orgName: organizations.name,
      orgType: organizations.type,
      orgStatus: organizations.status,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.orgId, organizations.id))
    .where(and(eq(organizationMembers.userId, user.id), eq(organizationMembers.status, "active")));
  const member = c.get("member");
  // Student / guardian portal links
  const { students, guardians } = await import("@classflow/db");
  const studentLinks = await db
    .select({ id: students.id, orgId: students.orgId, orgName: organizations.name, name: students.fullName })
    .from(students)
    .innerJoin(organizations, eq(students.orgId, organizations.id))
    .where(eq(students.userId, user.id));
  const guardianLinks = await db
    .select({ id: guardians.id, orgId: guardians.orgId, orgName: organizations.name })
    .from(guardians)
    .innerJoin(organizations, eq(guardians.orgId, organizations.id))
    .where(eq(guardians.userId, user.id));
  return ok({
    user,
    memberships,
    activeOrgId: member?.orgId ?? null,
    orgId: member?.orgId ?? null,
    member: member ? { role: member.role, permissions: [...member.permissions], orgId: member.orgId } : null,
    studentLinks,
    guardianLinks,
  });
});

authRoutes.post("/org/switch", requireAuth, async (c) => {
  const { orgId } = z.object({ orgId: z.string() }).parse(await c.req.json());
  const user = c.get("user")!;
  const db = c.get("db");
  const rows = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.userId, user.id),
        eq(organizationMembers.orgId, orgId),
        eq(organizationMembers.status, "active"),
      ),
    )
    .limit(1);
  if (!rows[0]) return notFound("Not a member of this organization");
  setCookie(c, ORG_COOKIE, orgId, cookieOpts(c.env));
  return ok({ orgId });
});

authRoutes.get("/sessions", requireAuth, async (c) => {
  const db = c.get("db");
  const user = c.get("user")!;
  const rows = await db
    .select({
      id: authSessions.id,
      userAgent: authSessions.userAgent,
      ip: authSessions.ip,
      createdAt: authSessions.createdAt,
      lastSeenAt: authSessions.lastSeenAt,
      expiresAt: authSessions.expiresAt,
    })
    .from(authSessions)
    .where(
      and(eq(authSessions.userId, user.id), gt(authSessions.expiresAt, nowIso())),
    );
  const current = c.get("sessionId");
  return ok(rows.map((s) => ({ ...s, current: s.id === current })));
});

authRoutes.delete("/sessions/:id", requireAuth, async (c) => {
  const db = c.get("db");
  const user = c.get("user")!;
  const id = c.req.param("id");
  const rows = await db
    .select()
    .from(authSessions)
    .where(and(eq(authSessions.id, id), eq(authSessions.userId, user.id)))
    .limit(1);
  if (!rows[0]) return notFound();
  await db.update(authSessions).set({ revokedAt: nowIso() }).where(eq(authSessions.id, id));
  return ok({ revoked: true });
});

// ---------- OTP / verification / password reset ----------

authRoutes.post(
  "/otp/send",
  rateLimit({ name: "otp_send", limit: 5, windowSeconds: 300 }),
  async (c) => {
    const db = c.get("db");
    const body = z
      .object({
        channel: z.enum(["email", "phone"]),
        destination: z.string().min(3),
        purpose: z.enum(["verify_email", "verify_phone", "password_reset", "login"]),
      })
      .parse(await c.req.json());
    const { destination, code } = await createOtp(db, body);
    // For password_reset the destination must belong to a real account
    if (body.purpose === "password_reset") {
      const exists = await db
        .select({ id: users.id })
        .from(users)
        .where(body.channel === "phone" ? eq(users.phone, destination) : eq(users.email, destination))
        .limit(1);
      if (!exists[0]) return ok({ sent: true }); // don't leak account existence
    }
    await dispatchChannel(db, c.env, {
      orgId: null,
      channel: body.channel === "phone" ? "sms" : "email",
      recipient: destination,
      body: `Your ClassFlow verification code is ${code}. It expires in 10 minutes.`,
      idempotencyKey: `otp:${body.purpose}:${destination}:${code}`,
    });
    return ok({ sent: true, ...(DEV_OTP_EXPOSE(c.env) ? { devCode: code } : {}) });
  },
);

authRoutes.post("/otp/verify", rateLimit({ name: "otp_verify", limit: 10, windowSeconds: 300 }), async (c) => {
  const db = c.get("db");
  const body = z
    .object({ destination: z.string().min(3), code: z.string().min(4).max(8), purpose: z.string() })
    .parse(await c.req.json());
  const dest = await verifyOtp(db, body);
  // mark verification on user if exists
  const col = body.purpose === "verify_phone" ? "phoneVerifiedAt" : body.purpose === "verify_email" ? "emailVerifiedAt" : null;
  if (col) {
    const rows = await db.select().from(users).where(
      body.purpose === "verify_phone" ? eq(users.phone, dest) : eq(users.email, dest),
    ).limit(1);
    if (rows[0]) {
      await db.update(users).set({ [col]: nowIso() }).where(eq(users.id, rows[0].id));
    }
  }
  return ok({ verified: true });
});

authRoutes.post("/password/reset", rateLimit({ name: "pw_reset", limit: 5, windowSeconds: 300 }), async (c) => {
  const db = c.get("db");
  const body = z
    .object({ destination: z.string().min(3), code: z.string().min(4).max(8), newPassword: z.string().min(8).max(128) })
    .parse(await c.req.json());
  const dest = await verifyOtp(db, { ...body, purpose: "password_reset" });
  const rows = await db
    .select()
    .from(users)
    .where(dest.startsWith("+") ? eq(users.phone, dest) : eq(users.email, dest))
    .limit(1);
  if (!rows[0]) return badRequest("Account not found");
  await db.update(users).set({ passwordHash: await hashPassword(body.newPassword), updatedAt: nowIso() }).where(eq(users.id, rows[0].id));
  // revoke all sessions for safety
  await db.update(authSessions).set({ revokedAt: nowIso() }).where(eq(authSessions.userId, rows[0].id));
  await audit(db, { orgId: null, actorUserId: rows[0].id, action: "PASSWORD_RESET", entity: "user", entityId: rows[0].id });
  return ok({ reset: true });
});

// Dev helper: ensures global subscription plans exist (idempotent)
authRoutes.post("/bootstrap", async (c) => {
  await ensureDefaultPlans(c.get("db"));
  return ok({ done: true });
});
