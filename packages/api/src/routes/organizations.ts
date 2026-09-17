import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import {
  organizations,
  organizationMembers,
  invites,
  users,
  teachers,
  subjects,
  grades,
  streams,
} from "@classflow/db";
import { ORG_ROLES, PERMISSIONS, type OrgRole } from "@classflow/core";
import type { Env } from "../env";
import type { ApiVariables } from "../middleware/session";
import { requireAuth, requireMember, requirePerm } from "../middleware/guard";
import { ok, notFound, badRequest, forbidden, nowIso } from "../lib/http";
import { audit } from "../lib/audit";
import { uuid, randomToken } from "../lib/crypto";
import { createOrgForUser, seedOrgReferenceData } from "../services/auth";

export const orgRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

orgRoutes.use("*", requireAuth);

orgRoutes.get("/permissions", requireMember, (c) => ok(PERMISSIONS));

/** Organizations the current user belongs to + create new (teacher adds institute etc.) */
orgRoutes.get("/", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const rows = await db
    .select({
      memberId: organizationMembers.id,
      orgId: organizationMembers.orgId,
      role: organizationMembers.role,
      name: organizations.name,
      type: organizations.type,
      status: organizations.status,
      studentIdPrefix: organizations.studentIdPrefix,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.orgId, organizations.id))
    .where(and(eq(organizationMembers.userId, user.id), eq(organizationMembers.status, "active")));
  return ok(rows);
});

orgRoutes.post("/", async (c) => {
  const user = c.get("user")!;
  const body = z
    .object({ name: z.string().min(2).max(160), type: z.enum(["individual", "institute"]).default("institute") })
    .parse(await c.req.json());
  const db = c.get("db");
  const orgId = await createOrgForUser(db, user.id, body.name.trim(), body.type);
  await audit(db, { orgId, actorUserId: user.id, action: "ORGANIZATION_CREATED", entity: "organization", entityId: orgId });
  return ok({ orgId }, { status: 201 });
});

orgRoutes.get("/current", requireMember, async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const rows = await db.select().from(organizations).where(eq(organizations.id, member.orgId)).limit(1);
  if (!rows[0]) return notFound();
  const org = rows[0];
  return ok({
    ...org,
    settings: JSON.parse(org.settingsJson || "{}"),
    myRole: member.role,
    myPermissions: [...member.permissions],
  });
});

orgRoutes.patch("/current", requirePerm("settings.manage"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = z
    .object({
      name: z.string().min(2).max(160).optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      address: z.string().max(500).optional(),
      studentIdPrefix: z.string().min(2).max(8).optional(),
      attendanceAlertThreshold: z.number().int().min(1).max(100).optional(),
      settings: z.record(z.string(), z.unknown()).optional(),
      logoKey: z.string().optional(),
    })
    .parse(await c.req.json());
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  for (const k of ["name", "phone", "email", "address", "studentIdPrefix", "attendanceAlertThreshold", "logoKey"] as const) {
    if (body[k] !== undefined) patch[k] = body[k];
  }
  if (body.settings) {
    const existing = await db.select({ s: organizations.settingsJson }).from(organizations).where(eq(organizations.id, member.orgId)).limit(1);
    const merged = { ...JSON.parse(existing[0]?.s || "{}"), ...body.settings };
    patch.settingsJson = JSON.stringify(merged);
  }
  await db.update(organizations).set(patch).where(eq(organizations.id, member.orgId));
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "ORGANIZATION_UPDATED", entity: "organization", entityId: member.orgId, metadata: body.settings as Record<string, unknown> });
  return ok({ updated: true });
});

// ---------- Members & roles ----------

orgRoutes.get("/members", requireMember, async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const rows = await db
    .select({
      id: organizationMembers.id,
      userId: organizationMembers.userId,
      role: organizationMembers.role,
      status: organizationMembers.status,
      grantsJson: organizationMembers.grantsJson,
      revokesJson: organizationMembers.revokesJson,
      fullName: users.fullName,
      email: users.email,
      phone: users.phone,
      createdAt: organizationMembers.createdAt,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.orgId, member.orgId));
  return ok(rows.map((r) => ({ ...r, grants: JSON.parse(r.grantsJson || "[]"), revokes: JSON.parse(r.revokesJson || "[]") })));
});

orgRoutes.patch("/members/:id", requirePerm("staff.manage"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const id = c.req.param("id");
  const body = z
    .object({
      role: z.enum(ORG_ROLES).optional(),
      grants: z.array(z.string()).optional(),
      revokes: z.array(z.string()).optional(),
      status: z.enum(["active", "suspended"]).optional(),
    })
    .parse(await c.req.json());
  const rows = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.id, id), eq(organizationMembers.orgId, member.orgId)))
    .limit(1);
  const target = rows[0];
  if (!target) return notFound();
  if (target.role === "owner" && body.role && body.role !== "owner") {
    return forbidden("Cannot demote the organization owner");
  }
  const patch: Record<string, unknown> = {};
  if (body.role) patch.role = body.role;
  if (body.status) patch.status = body.status;
  if (body.grants) patch.grantsJson = JSON.stringify(body.grants);
  if (body.revokes) patch.revokesJson = JSON.stringify(body.revokes);
  await db.update(organizationMembers).set(patch).where(eq(organizationMembers.id, id));
  await audit(db, {
    orgId: member.orgId,
    actorUserId: user.id,
    action: "ROLE_CHANGED",
    entity: "organization_member",
    entityId: id,
    metadata: { role: body.role, status: body.status },
  });
  return ok({ updated: true });
});

orgRoutes.delete("/members/:id", requirePerm("staff.manage"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const id = c.req.param("id");
  const rows = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.id, id), eq(organizationMembers.orgId, member.orgId)))
    .limit(1);
  if (!rows[0]) return notFound();
  if (rows[0].role === "owner") return forbidden("Cannot remove the owner");
  if (rows[0].userId === user.id) return forbidden("Cannot remove yourself");
  await db.update(organizationMembers).set({ status: "removed" }).where(eq(organizationMembers.id, id));
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "MEMBER_REMOVED", entity: "organization_member", entityId: id });
  return ok({ removed: true });
});

// ---------- Invites ----------

orgRoutes.post("/invites", requirePerm("staff.manage"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = z
    .object({
      email: z.string().email().optional(),
      phone: z.string().optional(),
      role: z.enum(["admin", "teacher", "staff"]).default("staff"),
      teacherName: z.string().optional(),
    })
    .parse(await c.req.json());
  if (!body.email && !body.phone) return badRequest("email or phone required");
  const token = randomToken(24);
  const id = uuid();
  await db.insert(invites).values({
    id,
    orgId: member.orgId,
    email: body.email?.toLowerCase() ?? null,
    phone: body.phone ?? null,
    role: body.role,
    token,
    status: "pending",
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    createdAt: nowIso(),
  });
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "INVITE_CREATED", entity: "invite", entityId: id });
  return ok({ id, token, inviteUrl: `/join/${token}` }, { status: 201 });
});

orgRoutes.get("/invites", requirePerm("staff.manage"), async (c) => {
  const member = c.get("member")!;
  const rows = await c.get("db").select().from(invites).where(eq(invites.orgId, member.orgId)).orderBy(desc(invites.createdAt));
  return ok(rows);
});

/** Accept an invite — logged-in user joins org */
orgRoutes.post("/invites/:token/accept", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const token = c.req.param("token");
  const rows = await db.select().from(invites).where(eq(invites.token, token)).limit(1);
  const invite = rows[0];
  if (!invite || invite.status !== "pending" || invite.expiresAt < nowIso()) {
    return badRequest("Invite is invalid or expired");
  }
  await db.insert(organizationMembers).values({
    id: uuid(),
    orgId: invite.orgId,
    userId: user.id,
    role: invite.role as OrgRole,
    status: "active",
    createdAt: nowIso(),
  });
  if (invite.role === "teacher") {
    await db.insert(teachers).values({
      id: uuid(),
      orgId: invite.orgId,
      userId: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      status: "active",
      createdAt: nowIso(),
    });
  }
  await db.update(invites).set({ status: "accepted" }).where(eq(invites.id, invite.id));
  await audit(db, { orgId: invite.orgId, actorUserId: user.id, action: "MEMBER_JOINED", entity: "organization", entityId: invite.orgId });
  return ok({ orgId: invite.orgId });
});

orgRoutes.get("/invites/:token", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select({ orgName: organizations.name, role: invites.role, status: invites.status, expiresAt: invites.expiresAt })
    .from(invites)
    .innerJoin(organizations, eq(invites.orgId, organizations.id))
    .where(eq(invites.token, c.req.param("token")))
    .limit(1);
  if (!rows[0]) return notFound();
  return ok(rows[0]);
});

// ---------- Reference data (subjects/grades/streams — configurable) ----------

orgRoutes.get("/reference", requireMember, async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const [subs, grds, strs] = await Promise.all([
    db.select().from(subjects).where(eq(subjects.orgId, member.orgId)),
    db.select().from(grades).where(eq(grades.orgId, member.orgId)).orderBy(grades.sortOrder),
    db.select().from(streams).where(eq(streams.orgId, member.orgId)),
  ]);
  return ok({ subjects: subs, grades: grds, streams: strs, mediums: ["sinhala", "tamil", "english"] });
});

const refSchema = z.object({ name: z.string().min(1).max(120) });

for (const [kind, table] of [
  ["subjects", subjects],
  ["grades", grades],
  ["streams", streams],
] as const) {
  orgRoutes.post(`/reference/${kind}`, requirePerm("settings.manage"), async (c) => {
    const member = c.get("member")!;
    const body = refSchema.parse(await c.req.json());
    const id = uuid();
    await c.get("db").insert(table).values({ id, orgId: member.orgId, name: body.name } as never);
    return ok({ id }, { status: 201 });
  });

  orgRoutes.delete(`/reference/${kind}/:id`, requirePerm("settings.manage"), async (c) => {
    const member = c.get("member")!;
    await c.get("db").delete(table).where(and(eq(table.id, c.req.param("id")), eq(table.orgId, member.orgId)));
    return ok({ deleted: true });
  });
}

/** Re-seed reference data if empty (onboarding helper) */
orgRoutes.post("/reference/seed", requireMember, async (c) => {
  await seedOrgReferenceData(c.get("db"), c.get("member")!.orgId);
  return ok({ seeded: true });
});
