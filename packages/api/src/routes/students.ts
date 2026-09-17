import { Hono } from "hono";
import { eq, and, desc, like, or, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  students,
  guardians,
  studentGuardians,
  classEnrollments,
  classes,
  subjects,
  grades,
  users,
  importJobs,
  organizations,
  subscriptionPlans,
  subscriptions,
  type Database,
} from "@classflow/db";
import { studentSchema, guardianSchema, csvStudentRowSchema, normalizeLKPhone } from "@classflow/core";
import type { Env } from "../env";
import type { ApiVariables } from "../middleware/session";
import { requireAuth, requirePerm } from "../middleware/guard";
import { ok, notFound, badRequest, parsePagination, nowIso } from "../lib/http";
import { audit } from "../lib/audit";
import { uuid, hashPassword, randomToken } from "../lib/crypto";
import { enqueueAll } from "../services/notify";

export const studentRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

studentRoutes.use("*", requireAuth);

async function nextStudentNo(db: Database, orgId: string) {
  await db
    .update(organizations)
    .set({ studentIdSeq: sql`${organizations.studentIdSeq} + 1` })
    .where(eq(organizations.id, orgId));
  const org = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const o = org[0]!;
  return `${o.studentIdPrefix}-${String(o.studentIdSeq).padStart(6, "0")}`;
}

async function checkStudentLimit(db: Database, orgId: string, adding: number) {
  const sub = await db
    .select({ studentLimit: subscriptionPlans.studentLimit, planName: subscriptionPlans.name })
    .from(subscriptions)
    .innerJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
    .where(and(eq(subscriptions.orgId, orgId), eq(subscriptions.status, "active")))
    .limit(1);
  const limit = sub[0]?.studentLimit;
  if (limit == null) return; // unlimited or no sub
  const countRows = await db
    .select({ n: sql<number>`count(*)` })
    .from(students)
    .where(and(eq(students.orgId, orgId), isNull(students.deletedAt)));
  if ((countRows[0]?.n ?? 0) + adding > limit) {
    badRequest(`Student limit reached for your ${sub[0]?.planName} plan (${limit}). Upgrade to add more.`);
  }
}

// ---------- Students ----------

studentRoutes.get("/", requirePerm("students.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const { limit, offset } = parsePagination(c.req.url);
  const q = new URL(c.req.url).searchParams;
  const search = q.get("q")?.trim();
  const status = q.get("status");
  const gradeId = q.get("gradeId");
  const classId = q.get("classId");
  const conds = [eq(students.orgId, member.orgId), isNull(students.deletedAt)];
  if (status) conds.push(eq(students.status, status));
  if (gradeId) conds.push(eq(students.gradeId, gradeId));
  if (search) {
    const likeStr = `%${search}%`;
    conds.push(or(like(students.fullName, likeStr), like(students.studentNo, likeStr), like(students.phone, likeStr))!);
  }
  let rows;
  if (classId) {
    rows = await db
      .select({ student: students, enrollment: classEnrollments })
      .from(classEnrollments)
      .innerJoin(students, eq(classEnrollments.studentId, students.id))
      .where(and(eq(classEnrollments.classId, classId), eq(classEnrollments.status, "active"), ...conds))
      .orderBy(students.fullName)
      .limit(limit)
      .offset(offset);
    return ok(rows.map((r) => ({ ...r.student, enrollmentStatus: r.enrollment.status, enrollmentId: r.enrollment.id })));
  }
  rows = await db
    .select({ student: students, gradeName: grades.name })
    .from(students)
    .leftJoin(grades, eq(students.gradeId, grades.id))
    .where(and(...conds))
    .orderBy(students.fullName)
    .limit(limit)
    .offset(offset);
  const totalRows = await db
    .select({ n: sql<number>`count(*)` })
    .from(students)
    .where(and(...conds));
  return ok({ students: rows.map((r) => ({ ...r.student, gradeName: r.gradeName })), total: totalRows[0]?.n ?? 0, page: Math.floor(offset / limit) + 1, limit });
});

studentRoutes.post("/", requirePerm("students.create"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = studentSchema
    .extend({ guardianName: z.string().optional(), guardianPhone: z.string().optional(), classId: z.string().optional() })
    .parse(await c.req.json());
  await checkStudentLimit(db, member.orgId, 1);
  const now = nowIso();
  const id = uuid();
  const studentNo = await nextStudentNo(db, member.orgId);
  await db.insert(students).values({
    id,
    orgId: member.orgId,
    studentNo,
    fullName: body.fullName.trim(),
    preferredName: body.preferredName ?? null,
    dateOfBirth: body.dateOfBirth ?? null,
    gender: body.gender ?? null,
    school: body.school ?? null,
    gradeId: body.gradeId ?? null,
    medium: body.medium ?? null,
    streamId: body.streamId ?? null,
    address: body.address ?? null,
    phone: body.phone ? normalizeLKPhone(body.phone) : null,
    email: body.email ?? null,
    emergencyContactJson: JSON.stringify(body.emergencyContact ?? {}),
    status: body.status ?? "active",
    notes: body.notes ?? null,
    createdAt: now,
    updatedAt: now,
  });
  // Optional: link a guardian (dedupe by phone) and/or enroll into a class in one call
  if (body.guardianName && body.guardianPhone) {
    const gPhone = normalizeLKPhone(body.guardianPhone);
    if (!gPhone) return badRequest("Invalid guardian phone");
    let guardian = (
      await db.select().from(guardians).where(and(eq(guardians.orgId, member.orgId), eq(guardians.phone, gPhone))).limit(1)
    )[0];
    if (!guardian) {
      const gid = uuid();
      await db.insert(guardians).values({ id: gid, orgId: member.orgId, fullName: body.guardianName.trim(), phone: gPhone, createdAt: now });
      guardian = (await db.select().from(guardians).where(eq(guardians.id, gid)).limit(1))[0]!;
    }
    await db.insert(studentGuardians).values({
      id: uuid(),
      orgId: member.orgId,
      studentId: id,
      guardianId: guardian.id,
      relationship: "guardian",
      isPrimary: true,
      receivesNotifications: true,
      createdAt: now,
    });
  }
  if (body.classId) {
    const cls = await db
      .select({ id: classes.id })
      .from(classes)
      .where(and(eq(classes.id, body.classId), eq(classes.orgId, member.orgId), isNull(classes.deletedAt)))
      .limit(1);
    if (!cls[0]) return badRequest("Class not found");
    await db.insert(classEnrollments).values({ id: uuid(), orgId: member.orgId, classId: body.classId, studentId: id, discountCents: 0, status: "active", enrolledAt: now.slice(0, 10) });
  }
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "STUDENT_CREATED", entity: "student", entityId: id });
  return ok({ id, studentNo }, { status: 201 });
});

async function getStudent(db: Database, orgId: string, id: string) {
  const rows = await db
    .select()
    .from(students)
    .where(and(eq(students.id, id), eq(students.orgId, orgId), isNull(students.deletedAt)))
    .limit(1);
  if (!rows[0]) notFound("Student not found");
  return rows[0]!;
}

studentRoutes.get("/:id", requirePerm("students.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const s = await getStudent(db, member.orgId, c.req.param("id"));
  const guardianRows = await db
    .select({ link: studentGuardians, guardian: guardians })
    .from(studentGuardians)
    .innerJoin(guardians, eq(studentGuardians.guardianId, guardians.id))
    .where(eq(studentGuardians.studentId, s.id));
  const enrollments = await db
    .select({
      id: classEnrollments.id,
      status: classEnrollments.status,
      enrolledAt: classEnrollments.enrolledAt,
      classId: classes.id,
      className: classes.name,
      subjectName: subjects.name,
      feeCents: classes.feeCents,
      feePeriod: classes.feePeriod,
    })
    .from(classEnrollments)
    .innerJoin(classes, eq(classEnrollments.classId, classes.id))
    .innerJoin(subjects, eq(classes.subjectId, subjects.id))
    .where(and(eq(classEnrollments.studentId, s.id), eq(classEnrollments.orgId, member.orgId)));
  const grade = s.gradeId
    ? (await db.select().from(grades).where(eq(grades.id, s.gradeId)).limit(1))[0]
    : null;
  return ok({ ...s, emergencyContact: JSON.parse(s.emergencyContactJson || "{}"), guardians: guardianRows, enrollments, grade });
});

studentRoutes.patch("/:id", requirePerm("students.update"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const s = await getStudent(db, member.orgId, c.req.param("id"));
  const body = studentSchema.partial().parse(await c.req.json());
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  const map: Record<string, string> = {
    fullName: "fullName",
    preferredName: "preferredName",
    dateOfBirth: "dateOfBirth",
    gender: "gender",
    school: "school",
    gradeId: "gradeId",
    medium: "medium",
    streamId: "streamId",
    address: "address",
    email: "email",
    notes: "notes",
    status: "status",
  };
  for (const [k, col] of Object.entries(map)) {
    const v = (body as Record<string, unknown>)[k];
    if (v !== undefined) patch[col] = v;
  }
  if (body.phone !== undefined) patch.phone = body.phone ? normalizeLKPhone(body.phone) : null;
  if (body.emergencyContact !== undefined) patch.emergencyContactJson = JSON.stringify(body.emergencyContact ?? {});
  await db.update(students).set(patch).where(eq(students.id, s.id));
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "STUDENT_UPDATED", entity: "student", entityId: s.id, metadata: { fields: Object.keys(patch) } });
  return ok({ updated: true });
});

studentRoutes.delete("/:id", requirePerm("students.delete"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const s = await getStudent(db, member.orgId, c.req.param("id"));
  await db.update(students).set({ deletedAt: nowIso(), status: "dropped" }).where(eq(students.id, s.id));
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "STUDENT_REMOVED", entity: "student", entityId: s.id });
  return ok({ deleted: true });
});

/** Provision a student login so they can use the student portal */
studentRoutes.post("/:id/account", requirePerm("students.update"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const s = await getStudent(db, member.orgId, c.req.param("id"));
  if (s.userId) return badRequest("Student already has a login");
  const body = z.object({ email: z.string().email().optional(), phone: z.string().optional(), password: z.string().min(8).optional() }).parse(await c.req.json());
  const email = body.email ?? s.email ?? null;
  const phone = body.phone ? normalizeLKPhone(body.phone) : s.phone;
  if (!email && !phone) return badRequest("Student needs an email or phone for login");
  const password = body.password ?? randomToken(8);
  // reuse existing user if email/phone matches
  let uid: string;
  const existing = email
    ? await db.select().from(users).where(eq(users.email, email)).limit(1)
    : await db.select().from(users).where(eq(users.phone, phone!)).limit(1);
  if (existing[0]) {
    uid = existing[0].id;
  } else {
    uid = uuid();
    await db.insert(users).values({
      id: uid,
      email,
      phone,
      passwordHash: await hashPassword(password),
      fullName: s.fullName,
      status: "active",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }
  await db.update(students).set({ userId: uid, updatedAt: nowIso() }).where(eq(students.id, s.id));
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "STUDENT_ACCOUNT_CREATED", entity: "student", entityId: s.id });
  return ok({ userId: uid, temporaryPassword: existing[0] ? undefined : password });
});

// ---------- Guardians ----------

studentRoutes.get("/:id/guardians", requirePerm("guardians.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const s = await getStudent(db, member.orgId, c.req.param("id"));
  const rows = await db
    .select({ link: studentGuardians, guardian: guardians })
    .from(studentGuardians)
    .innerJoin(guardians, eq(studentGuardians.guardianId, guardians.id))
    .where(eq(studentGuardians.studentId, s.id));
  return ok(rows);
});

studentRoutes.post("/:id/guardians", requirePerm("guardians.manage"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const s = await getStudent(db, member.orgId, c.req.param("id"));
  const body = guardianSchema.parse(await c.req.json());
  const phone = normalizeLKPhone(body.phone);
  if (!phone) return badRequest("Invalid guardian phone");
  // dedupe by phone within org
  let guardian = (
    await db.select().from(guardians).where(and(eq(guardians.orgId, member.orgId), eq(guardians.phone, phone))).limit(1)
  )[0];
  if (!guardian) {
    const id = uuid();
    await db.insert(guardians).values({
      id,
      orgId: member.orgId,
      fullName: body.fullName.trim(),
      phone,
      email: body.email ?? null,
      address: body.address ?? null,
      createdAt: nowIso(),
    });
    guardian = (await db.select().from(guardians).where(eq(guardians.id, id)).limit(1))[0]!;
  }
  const existing = await db
    .select()
    .from(studentGuardians)
    .where(and(eq(studentGuardians.studentId, s.id), eq(studentGuardians.guardianId, guardian.id)))
    .limit(1);
  if (existing[0]) return badRequest("Guardian already linked to this student");
  const linkId = uuid();
  await db.insert(studentGuardians).values({
    id: linkId,
    orgId: member.orgId,
    studentId: s.id,
    guardianId: guardian.id,
    relationship: body.relationship ?? "guardian",
    isPrimary: body.isPrimary ?? false,
    receivesNotifications: body.receivesNotifications ?? true,
    createdAt: nowIso(),
  });
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "GUARDIAN_LINKED", entity: "student", entityId: s.id, metadata: { guardianId: guardian.id } });
  return ok({ linkId, guardianId: guardian.id }, { status: 201 });
});

studentRoutes.delete("/:id/guardians/:linkId", requirePerm("guardians.manage"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  await getStudent(db, member.orgId, c.req.param("id"));
  await db
    .delete(studentGuardians)
    .where(and(eq(studentGuardians.id, c.req.param("linkId")), eq(studentGuardians.orgId, member.orgId)));
  return ok({ unlinked: true });
});

/** Provision a guardian login → parent portal */
studentRoutes.post("/:id/guardians/:guardianId/account", requirePerm("guardians.manage"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const guardian = (
    await db.select().from(guardians).where(and(eq(guardians.id, c.req.param("guardianId")), eq(guardians.orgId, member.orgId))).limit(1)
  )[0];
  if (!guardian) return notFound("Guardian not found");
  if (guardian.userId) return badRequest("Guardian already has a login");
  const password = randomToken(8);
  const existing = await db.select().from(users).where(eq(users.phone, guardian.phone)).limit(1);
  let uid: string;
  if (existing[0]) {
    uid = existing[0].id;
  } else {
    uid = uuid();
    await db.insert(users).values({
      id: uid,
      email: guardian.email,
      phone: guardian.phone,
      passwordHash: await hashPassword(password),
      fullName: guardian.fullName,
      status: "active",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }
  await db.update(guardians).set({ userId: uid }).where(eq(guardians.id, guardian.id));
  return ok({ userId: uid, temporaryPassword: existing[0] ? undefined : password });
});

// ---------- CSV import ----------

studentRoutes.post("/import/preview", requirePerm("students.import"), async (c) => {
  const body = z.object({ rows: z.array(z.record(z.string(), z.string())).min(1).max(5000) }).parse(await c.req.json());
  const validated = body.rows.map((r, i) => {
    const parsed = csvStudentRowSchema.safeParse(r);
    const phoneOk = !r.phone || !!normalizeLKPhone(r.phone);
    const gPhoneOk = !r.guardianPhone || !!normalizeLKPhone(r.guardianPhone);
    return {
      row: i + 1,
      data: r,
      valid: parsed.success && phoneOk && gPhoneOk,
      errors: [
        ...(parsed.success ? [] : parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`)),
        ...(phoneOk ? [] : ["phone: invalid Sri Lankan number"]),
        ...(gPhoneOk ? [] : ["guardianPhone: invalid Sri Lankan number"]),
      ],
    };
  });
  return ok({
    total: validated.length,
    valid: validated.filter((v) => v.valid).length,
    invalid: validated.filter((v) => !v.valid).length,
    rows: validated.slice(0, 200),
  });
});

studentRoutes.post("/import", requirePerm("students.import"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = z.object({ rows: z.array(z.record(z.string(), z.string())).min(1).max(5000) }).parse(await c.req.json());
  await checkStudentLimit(db, member.orgId, body.rows.length);
  // Small imports run synchronously; large ones go to the jobs queue
  if (body.rows.length > 200 && c.env.JOBS_QUEUE) {
    const jobId = uuid();
    await db.insert(importJobs).values({
      id: jobId,
      orgId: member.orgId,
      kind: "students_csv",
      status: "pending",
      total: body.rows.length,
      payloadJson: JSON.stringify({ rows: body.rows }),
      createdBy: user.id,
      createdAt: nowIso(),
    });
    await enqueueAll(c.env, "JOBS_QUEUE", [{ kind: "students_csv", jobId }]);
    return ok({ queued: true, jobId }, { status: 202 });
  }
  const result = await importStudentRows(db, member.orgId, body.rows, user.id);
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "STUDENTS_IMPORTED", entity: "import", metadata: result });
  return ok(result);
});

studentRoutes.get("/import/:jobId", requirePerm("students.view"), async (c) => {
  const member = c.get("member")!;
  const rows = await c.get("db").select().from(importJobs).where(and(eq(importJobs.id, c.req.param("jobId")), eq(importJobs.orgId, member.orgId))).limit(1);
  if (!rows[0]) return notFound();
  return ok({ ...rows[0], errors: JSON.parse(rows[0].errorsJson || "[]") });
});

export async function importStudentRows(
  db: Database,
  orgId: string,
  rows: Record<string, string>[],
  actorId: string,
) {
  const errors: { row: number; errors: string[] }[] = [];
  const gradeRows = await db.select().from(grades).where(eq(grades.orgId, orgId));
  const classRows = await db.select().from(classes).where(eq(classes.orgId, orgId));
  const gradeByName = new Map(gradeRows.map((g) => [g.name.toLowerCase(), g.id]));
  const classByName = new Map(classRows.map((cl) => [cl.name.toLowerCase(), cl.id]));
  let imported = 0;
  for (const [i, r] of rows.entries()) {
    const parsed = csvStudentRowSchema.safeParse(r);
    const rowErrs: string[] = [];
    if (!parsed.success) rowErrs.push(...parsed.error.issues.map((e) => e.message));
    const phone = r.phone ? normalizeLKPhone(r.phone) : null;
    if (r.phone && !phone) rowErrs.push("invalid phone");
    const gPhone = r.guardianPhone ? normalizeLKPhone(r.guardianPhone) : null;
    if (r.guardianPhone && !gPhone) rowErrs.push("invalid guardian phone");
    if (rowErrs.length) {
      errors.push({ row: i + 1, errors: rowErrs });
      continue;
    }
    const studentId = uuid();
    const studentNo = await nextStudentNo(db, orgId);
    const now = nowIso();
    await db.insert(students).values({
      id: studentId,
      orgId,
      studentNo,
      fullName: parsed.data!.name.trim(),
      phone,
      gradeId: r.grade ? gradeByName.get(r.grade.toLowerCase()) ?? null : null,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    if (r.guardian || gPhone) {
      const gPhoneFinal = gPhone ?? phone;
      if (gPhoneFinal) {
        let guardian = (
          await db.select().from(guardians).where(and(eq(guardians.orgId, orgId), eq(guardians.phone, gPhoneFinal))).limit(1)
        )[0];
        if (!guardian) {
          const gid = uuid();
          await db.insert(guardians).values({
            id: gid,
            orgId,
            fullName: (r.guardian || "Guardian").trim(),
            phone: gPhoneFinal,
            createdAt: now,
          });
          guardian = (await db.select().from(guardians).where(eq(guardians.id, gid)).limit(1))[0]!;
        }
        await db.insert(studentGuardians).values({
          id: uuid(),
          orgId,
          studentId,
          guardianId: guardian.id,
          relationship: "guardian",
          isPrimary: true,
          receivesNotifications: true,
          createdAt: now,
        });
      }
    }
    if (r.class) {
      const classId = classByName.get(r.class.toLowerCase());
      if (classId) {
        await db.insert(classEnrollments).values({
          id: uuid(),
          orgId,
          classId,
          studentId,
          status: "active",
          enrolledAt: now,
        }).onConflictDoNothing();
      }
    }
    imported++;
  }
  return { imported, failed: errors.length, errors };
}
