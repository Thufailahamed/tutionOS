import { Hono } from "hono";
import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";
import { teachers, organizationMembers, users, classes } from "@classflow/db";
import { normalizeLKPhone } from "@classflow/core";
import type { Env } from "../env";
import type { ApiVariables } from "../middleware/session";
import { requireAuth, requirePerm, requireMember } from "../middleware/guard";
import { ok, notFound, badRequest, nowIso } from "../lib/http";
import { audit } from "../lib/audit";
import { uuid } from "../lib/crypto";

export const teacherRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

teacherRoutes.use("*", requireAuth, requireMember);

/** Staff & teacher directory for the org. */
teacherRoutes.get("/", async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const rows = await db
    .select({
      teacher: teachers,
      memberRole: organizationMembers.role,
      memberStatus: organizationMembers.status,
      classCount: (await import("drizzle-orm")).sql<number>`(select count(*) from classes cl where cl.teacher_id = ${teachers.id} and cl.status='active' and cl.deleted_at is null)`,
    })
    .from(teachers)
    .leftJoin(organizationMembers, eq(teachers.memberId, organizationMembers.id))
    .where(and(eq(teachers.orgId, member.orgId), isNull(teachers.deletedAt)));
  return ok(rows.map((r) => ({ ...r.teacher, memberRole: r.memberRole, memberStatus: r.memberStatus, activeClasses: r.classCount, subjects: JSON.parse(r.teacher.subjectsJson || "[]") })));
});

teacherRoutes.post("/", requirePerm("staff.manage"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = z
    .object({
      fullName: z.string().min(2).max(160),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      subjects: z.array(z.string()).optional(),
      memberUserId: z.string().optional(),
    })
    .parse(await c.req.json());
  let memberId: string | null = null;
  if (body.memberUserId) {
    const m = await db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, member.orgId), eq(organizationMembers.userId, body.memberUserId), eq(organizationMembers.status, "active")))
      .limit(1);
    if (!m[0]) return badRequest("User is not an active member");
    memberId = m[0].id;
  }
  const id = uuid();
  await db.insert(teachers).values({
    id,
    orgId: member.orgId,
    userId: body.memberUserId ?? null,
    memberId,
    fullName: body.fullName.trim(),
    phone: body.phone ? normalizeLKPhone(body.phone) : null,
    email: body.email ?? null,
    subjectsJson: JSON.stringify(body.subjects ?? []),
    status: "active",
    createdAt: nowIso(),
  });
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "TEACHER_CREATED", entity: "teacher", entityId: id });
  return ok({ id }, { status: 201 });
});

teacherRoutes.patch("/:id", requirePerm("staff.manage"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const body = z
    .object({
      fullName: z.string().min(2).max(160).optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      subjects: z.array(z.string()).optional(),
      status: z.enum(["active", "inactive"]).optional(),
    })
    .parse(await c.req.json());
  const rows = await db.select().from(teachers).where(and(eq(teachers.id, c.req.param("id")), eq(teachers.orgId, member.orgId))).limit(1);
  if (!rows[0]) return notFound();
  const patch: Record<string, unknown> = {};
  if (body.fullName !== undefined) patch.fullName = body.fullName;
  if (body.phone !== undefined) patch.phone = body.phone ? normalizeLKPhone(body.phone) : null;
  if (body.email !== undefined) patch.email = body.email;
  if (body.subjects !== undefined) patch.subjectsJson = JSON.stringify(body.subjects);
  if (body.status !== undefined) patch.status = body.status;
  await db.update(teachers).set(patch).where(eq(teachers.id, rows[0].id));
  return ok({ updated: true });
});

teacherRoutes.delete("/:id", requirePerm("staff.manage"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const rows = await db.select().from(teachers).where(and(eq(teachers.id, c.req.param("id")), eq(teachers.orgId, member.orgId))).limit(1);
  if (!rows[0]) return notFound();
  await db.update(teachers).set({ deletedAt: nowIso(), status: "inactive" }).where(eq(teachers.id, rows[0].id));
  return ok({ deleted: true });
});

// ---------- Certificates ----------

import { certificates } from "@classflow/db";

teacherRoutes.get("/certificates/list", async (c) => {
  const member = c.get("member")!;
  const rows = await c.get("db").select().from(certificates).where(eq(certificates.orgId, member.orgId));
  return ok(rows);
});

teacherRoutes.post("/certificates", requirePerm("certificates.manage"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = z
    .object({
      studentId: z.string(),
      classId: z.string().optional(),
      type: z.enum(["completion", "participation", "achievement"]).default("completion"),
      title: z.string().min(2).max(200),
      fileKey: z.string().optional(),
    })
    .parse(await c.req.json());
  const id = uuid();
  await db.insert(certificates).values({
    id,
    orgId: member.orgId,
    studentId: body.studentId,
    classId: body.classId ?? null,
    type: body.type,
    title: body.title,
    fileKey: body.fileKey ?? null,
    issuedBy: user.id,
    issuedAt: nowIso(),
  });
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "CERTIFICATE_ISSUED", entity: "certificate", entityId: id });
  return ok({ id }, { status: 201 });
});
