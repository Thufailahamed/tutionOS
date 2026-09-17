import { Hono } from "hono";
import { eq, and, isNull, sql, inArray, gte, lte, ne } from "drizzle-orm";
import { z } from "zod";
import {
  classes,
  classSchedules,
  classSessions,
  classEnrollments,
  classWaitlist,
  subjects,
  grades,
  teachers,
  students,
  type Database,
} from "@classflow/db";
import { classSchema, scheduleSchema, sessionSchema, enrollmentSchema } from "@classflow/core";
import type { Env } from "../env";
import type { ApiVariables } from "../middleware/session";
import { requireAuth, requirePerm } from "../middleware/guard";
import { ok, notFound, badRequest, conflict, parsePagination, nowIso } from "../lib/http";
import { audit } from "../lib/audit";
import { uuid } from "../lib/crypto";

export const classRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

classRoutes.use("*", requireAuth);

export async function getClass(db: Database, orgId: string, id: string) {
  const rows = await db
    .select()
    .from(classes)
    .where(and(eq(classes.id, id), eq(classes.orgId, orgId), isNull(classes.deletedAt)))
    .limit(1);
  if (!rows[0]) notFound("Class not found");
  return rows[0]!;
}

// ---------- Classes ----------

classRoutes.get("/", requirePerm("classes.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const { limit, offset } = parsePagination(c.req.url);
  const status = new URL(c.req.url).searchParams.get("status") ?? "active";
  const rows = await db
    .select({
      class: classes,
      subjectName: subjects.name,
      gradeName: grades.name,
      teacherName: teachers.fullName,
      enrolled: sql<number>`(select count(*) from class_enrollments ce where ce.class_id = ${classes.id} and ce.status = 'active')`,
    })
    .from(classes)
    .innerJoin(subjects, eq(classes.subjectId, subjects.id))
    .leftJoin(grades, eq(classes.gradeId, grades.id))
    .leftJoin(teachers, eq(classes.teacherId, teachers.id))
    .where(and(eq(classes.orgId, member.orgId), isNull(classes.deletedAt), eq(classes.status, status)))
    .orderBy(classes.name)
    .limit(limit)
    .offset(offset);
  return ok(rows.map((r) => ({ ...r.class, subjectName: r.subjectName, gradeName: r.gradeName, teacherName: r.teacherName, enrolled: r.enrolled })));
});

classRoutes.post("/", requirePerm("classes.create"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = classSchema.extend({ schedules: z.array(scheduleSchema).optional() }).parse(await c.req.json());
  const subj = await db.select().from(subjects).where(and(eq(subjects.id, body.subjectId), eq(subjects.orgId, member.orgId))).limit(1);
  if (!subj[0]) return badRequest("Invalid subject");
  const id = uuid();
  const now = nowIso();
  await db.insert(classes).values({
    id,
    orgId: member.orgId,
    name: body.name.trim(),
    subjectId: body.subjectId,
    gradeId: body.gradeId ?? null,
    teacherId: body.teacherId ?? null,
    type: body.type,
    mode: body.mode,
    medium: body.medium ?? null,
    room: body.room ?? null,
    location: body.location ?? null,
    capacity: body.capacity ?? null,
    feeCents: body.feeCents,
    feePeriod: body.feePeriod,
    currency: body.currency,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  for (const s of body.schedules ?? []) {
    await db.insert(classSchedules).values({
      id: uuid(),
      orgId: member.orgId,
      classId: id,
      weekday: s.weekday,
      startTime: s.startTime,
      endTime: s.endTime,
      effectiveFrom: s.effectiveFrom ?? null,
      effectiveTo: s.effectiveTo ?? null,
      createdAt: now,
    });
  }
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "CLASS_CREATED", entity: "class", entityId: id });
  return ok({ id }, { status: 201 });
});

classRoutes.get("/:id", requirePerm("classes.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const cls = await getClass(db, member.orgId, c.req.param("id"));
  const schedules = await db.select().from(classSchedules).where(eq(classSchedules.classId, cls.id));
  const enrolled = await db
    .select({
      enrollmentId: classEnrollments.id,
      status: classEnrollments.status,
      enrolledAt: classEnrollments.enrolledAt,
      studentId: students.id,
      studentNo: students.studentNo,
      fullName: students.fullName,
    })
    .from(classEnrollments)
    .innerJoin(students, eq(classEnrollments.studentId, students.id))
    .where(and(eq(classEnrollments.classId, cls.id), eq(classEnrollments.status, "active")))
    .orderBy(students.fullName);
  const subject = (await db.select().from(subjects).where(eq(subjects.id, cls.subjectId)).limit(1))[0];
  const teacher = cls.teacherId ? (await db.select().from(teachers).where(eq(teachers.id, cls.teacherId)).limit(1))[0] : null;
  const waitlist = await db
    .select({ w: classWaitlist, studentName: students.fullName, studentNo: students.studentNo })
    .from(classWaitlist)
    .innerJoin(students, eq(classWaitlist.studentId, students.id))
    .where(and(eq(classWaitlist.classId, cls.id), eq(classWaitlist.status, "waiting")))
    .orderBy(classWaitlist.position);
  return ok({ ...cls, schedules, enrollments: enrolled, subject, teacher, waitlist, enrolledCount: enrolled.length });
});

classRoutes.patch("/:id", requirePerm("classes.manage"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const cls = await getClass(db, member.orgId, c.req.param("id"));
  const body = classSchema.partial().extend({ status: z.enum(["active", "archived"]).optional() }).parse(await c.req.json());
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) {
      const col = k === "feeCents" ? "feeCents" : k === "feePeriod" ? "feePeriod" : k === "subjectId" ? "subjectId" : k === "gradeId" ? "gradeId" : k === "teacherId" ? "teacherId" : k;
      patch[col] = v;
    }
  }
  await db.update(classes).set(patch).where(eq(classes.id, cls.id));
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "CLASS_UPDATED", entity: "class", entityId: cls.id });
  return ok({ updated: true });
});

classRoutes.delete("/:id", requirePerm("classes.manage"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const cls = await getClass(db, member.orgId, c.req.param("id"));
  await db.update(classes).set({ deletedAt: nowIso(), status: "archived" }).where(eq(classes.id, cls.id));
  return ok({ deleted: true });
});

// ---------- Schedules ----------

classRoutes.post("/:id/schedules", requirePerm("classes.manage"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const cls = await getClass(db, member.orgId, c.req.param("id"));
  const body = scheduleSchema.parse(await c.req.json());
  if (body.endTime <= body.startTime) return badRequest("End time must be after start time");
  const id = uuid();
  await db.insert(classSchedules).values({
    id,
    orgId: member.orgId,
    classId: cls.id,
    weekday: body.weekday,
    startTime: body.startTime,
    endTime: body.endTime,
    effectiveFrom: body.effectiveFrom ?? null,
    effectiveTo: body.effectiveTo ?? null,
    createdAt: nowIso(),
  });
  return ok({ id }, { status: 201 });
});

classRoutes.delete("/:id/schedules/:scheduleId", requirePerm("classes.manage"), async (c) => {
  const member = c.get("member")!;
  await getClass(c.get("db"), member.orgId, c.req.param("id"));
  await c.get("db").delete(classSchedules).where(and(eq(classSchedules.id, c.req.param("scheduleId")), eq(classSchedules.orgId, member.orgId)));
  return ok({ deleted: true });
});

// ---------- Sessions ----------

/**
 * Materialize scheduled sessions for a date range: creates class_sessions rows
 * from recurring schedules for days that don't have one yet. Idempotent.
 */
export async function materializeSessions(db: Database, orgId: string, fromDate: string, toDate: string) {
  const schedules = await db
    .select({ schedule: classSchedules, classId: classSchedules.classId })
    .from(classSchedules)
    .innerJoin(classes, eq(classSchedules.classId, classes.id))
    .where(and(eq(classSchedules.orgId, orgId), isNull(classes.deletedAt), eq(classes.status, "active")));
  const now = nowIso();
  const created: string[] = [];
  for (const { schedule } of schedules) {
    const start = schedule.effectiveFrom && schedule.effectiveFrom > fromDate ? schedule.effectiveFrom : fromDate;
    const end = schedule.effectiveTo && schedule.effectiveTo < toDate ? schedule.effectiveTo : toDate;
    if (start > end) continue;
    for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      if (d.getUTCDay() !== schedule.weekday) continue;
      const existing = await db
        .select({ id: classSessions.id })
        .from(classSessions)
        .where(and(eq(classSessions.classId, schedule.classId), eq(classSessions.date, dateStr), eq(classSessions.startTime, schedule.startTime)))
        .limit(1);
      if (existing[0]) continue;
      const id = uuid();
      await db.insert(classSessions).values({
        id,
        orgId,
        classId: schedule.classId,
        scheduleId: schedule.id,
        date: dateStr,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        status: "scheduled",
        createdAt: now,
      });
      created.push(id);
    }
  }
  return created;
}

classRoutes.get("/:id/sessions", requirePerm("classes.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const cls = await getClass(db, member.orgId, c.req.param("id"));
  const q = new URL(c.req.url).searchParams;
  const from = q.get("from") ?? new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
  const to = q.get("to") ?? new Date(Date.now() + 60 * 86400e3).toISOString().slice(0, 10);
  const rows = await db
    .select()
    .from(classSessions)
    .where(and(eq(classSessions.classId, cls.id), gte(classSessions.date, from), lte(classSessions.date, to)))
    .orderBy(classSessions.date, classSessions.startTime);
  return ok(rows);
});

classRoutes.post("/:id/sessions", requirePerm("classes.manage"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const cls = await getClass(db, member.orgId, c.req.param("id"));
  const body = sessionSchema.omit({ classId: true }).parse(await c.req.json());
  const id = uuid();
  await db.insert(classSessions).values({
    id,
    orgId: member.orgId,
    classId: cls.id,
    date: body.date,
    startTime: body.startTime,
    endTime: body.endTime,
    status: body.status ?? "scheduled",
    substituteTeacherId: body.substituteTeacherId ?? null,
    notes: body.notes ?? null,
    createdAt: nowIso(),
  });
  return ok({ id }, { status: 201 });
});

classRoutes.patch("/:id/sessions/:sessionId", requirePerm("classes.manage"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const cls = await getClass(db, member.orgId, c.req.param("id"));
  const body = sessionSchema.omit({ classId: true }).partial().parse(await c.req.json());
  const rows = await db.select().from(classSessions).where(and(eq(classSessions.id, c.req.param("sessionId")), eq(classSessions.classId, cls.id))).limit(1);
  if (!rows[0]) return notFound("Session not found");
  await db.update(classSessions).set(body as Record<string, unknown>).where(eq(classSessions.id, rows[0].id));
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "SESSION_UPDATED", entity: "class_session", entityId: rows[0].id });
  return ok({ updated: true });
});

// ---------- Enrollment & waitlist ----------

classRoutes.post("/:id/enrollments", requirePerm("students.update"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const cls = await getClass(db, member.orgId, c.req.param("id"));
  const body = z.object({ studentId: z.string(), status: z.string().optional() }).parse(await c.req.json());
  const student = await db.select().from(students).where(and(eq(students.id, body.studentId), eq(students.orgId, member.orgId))).limit(1);
  if (!student[0]) return badRequest("Student not found in this organization");
  const existing = await db
    .select()
    .from(classEnrollments)
    .where(and(eq(classEnrollments.classId, cls.id), eq(classEnrollments.studentId, body.studentId)))
    .limit(1);
  if (existing[0] && existing[0].status === "active") return conflict("Student already enrolled");
  if (cls.capacity != null) {
    const countRows = await db
      .select({ n: sql<number>`count(*)` })
      .from(classEnrollments)
      .where(and(eq(classEnrollments.classId, cls.id), eq(classEnrollments.status, "active")));
    if ((countRows[0]?.n ?? 0) >= cls.capacity && body.status !== "override") {
      // auto-add to waitlist
      const pos = await db
        .select({ n: sql<number>`coalesce(max(position),0)+1` })
        .from(classWaitlist)
        .where(and(eq(classWaitlist.classId, cls.id), eq(classWaitlist.status, "waiting")));
      const wid = uuid();
      await db.insert(classWaitlist).values({
        id: wid,
        orgId: member.orgId,
        classId: cls.id,
        studentId: body.studentId,
        position: pos[0]?.n ?? 1,
        status: "waiting",
        createdAt: nowIso(),
      });
      return ok({ waitlisted: true, waitlistId: wid, position: pos[0]?.n ?? 1 }, { status: 202 });
    }
  }
  let enrollmentId: string;
  if (existing[0]) {
    enrollmentId = existing[0].id;
    await db.update(classEnrollments).set({ status: "active", leftAt: null }).where(eq(classEnrollments.id, enrollmentId));
  } else {
    enrollmentId = uuid();
    await db.insert(classEnrollments).values({
      id: enrollmentId,
      orgId: member.orgId,
      classId: cls.id,
      studentId: body.studentId,
      status: "active",
      enrolledAt: nowIso(),
    });
  }
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "STUDENT_ENROLLED", entity: "class", entityId: cls.id, metadata: { studentId: body.studentId } });
  return ok({ enrollmentId, waitlisted: false }, { status: 201 });
});

classRoutes.delete("/:id/enrollments/:studentId", requirePerm("students.update"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const cls = await getClass(db, member.orgId, c.req.param("id"));
  const rows = await db
    .select()
    .from(classEnrollments)
    .where(and(eq(classEnrollments.classId, cls.id), eq(classEnrollments.studentId, c.req.param("studentId")), eq(classEnrollments.status, "active")))
    .limit(1);
  if (!rows[0]) return notFound("Enrollment not found");
  await db.update(classEnrollments).set({ status: "dropped", leftAt: nowIso() }).where(eq(classEnrollments.id, rows[0].id));
  // promote next waitlist entry
  const next = await db
    .select()
    .from(classWaitlist)
    .where(and(eq(classWaitlist.classId, cls.id), eq(classWaitlist.status, "waiting")))
    .orderBy(classWaitlist.position)
    .limit(1);
  if (next[0]) {
    await db.update(classWaitlist).set({ status: "offered" }).where(eq(classWaitlist.id, next[0].id));
  }
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "STUDENT_UNENROLLED", entity: "class", entityId: cls.id, metadata: { studentId: c.req.param("studentId") } });
  return ok({ removed: true, waitlistOffered: next[0]?.id ?? null });
});

classRoutes.post("/:id/waitlist/:waitlistId/accept", requirePerm("students.update"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const cls = await getClass(db, member.orgId, c.req.param("id"));
  const w = await db.select().from(classWaitlist).where(and(eq(classWaitlist.id, c.req.param("waitlistId")), eq(classWaitlist.classId, cls.id))).limit(1);
  if (!w[0]) return notFound();
  await db.update(classWaitlist).set({ status: "joined" }).where(eq(classWaitlist.id, w[0].id));
  const eid = uuid();
  await db.insert(classEnrollments).values({
    id: eid,
    orgId: member.orgId,
    classId: cls.id,
    studentId: w[0].studentId,
    status: "active",
    enrolledAt: nowIso(),
  }).onConflictDoNothing();
  return ok({ enrollmentId: eid });
});

// ---------- Scheduling conflict detection ----------

classRoutes.post("/conflicts/check", requirePerm("classes.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const body = z
    .object({
      date: z.string(),
      startTime: z.string(),
      endTime: z.string(),
      teacherId: z.string().optional(),
      room: z.string().optional(),
      studentIds: z.array(z.string()).optional(),
      excludeSessionId: z.string().optional(),
    })
    .parse(await c.req.json());
  const conflicts: { type: string; detail: string; sessionId?: string }[] = [];
  const daySessions = await db
    .select({ session: classSessions, className: classes.name, teacherId: classes.teacherId, room: classes.room })
    .from(classSessions)
    .innerJoin(classes, eq(classSessions.classId, classes.id))
    .where(and(eq(classSessions.orgId, member.orgId), eq(classSessions.date, body.date), ne(classSessions.status, "cancelled")));
  const overlap = (s: { startTime: string; endTime: string }) =>
    body.startTime < s.endTime && body.endTime > s.startTime;
  for (const s of daySessions) {
    if (body.excludeSessionId && s.session.id === body.excludeSessionId) continue;
    if (!overlap(s.session)) continue;
    if (body.teacherId && s.teacherId === body.teacherId) {
      conflicts.push({ type: "teacher", detail: `Teacher already has "${s.className}" ${s.session.startTime}-${s.session.endTime}`, sessionId: s.session.id });
    }
    if (body.room && s.room && s.room === body.room) {
      conflicts.push({ type: "room", detail: `Room ${body.room} occupied by "${s.className}" ${s.session.startTime}-${s.session.endTime}`, sessionId: s.session.id });
    }
  }
  if (body.studentIds?.length) {
    const enrolled = await db
      .select({ studentId: classEnrollments.studentId, classId: classEnrollments.classId })
      .from(classEnrollments)
      .where(and(eq(classEnrollments.orgId, member.orgId), inArray(classEnrollments.studentId, body.studentIds), eq(classEnrollments.status, "active")));
    const sessionClassIds = new Set(daySessions.filter((s) => overlap(s.session)).map((s) => s.session.classId));
    const conflicted = enrolled.filter((e) => sessionClassIds.has(e.classId));
    for (const e of conflicted) {
      conflicts.push({ type: "student", detail: `Student ${e.studentId} has another class at this time` });
    }
  }
  return ok({ conflicts, hasConflicts: conflicts.length > 0 });
});
