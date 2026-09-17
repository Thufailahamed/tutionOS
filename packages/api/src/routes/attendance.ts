import { Hono } from "hono";
import { eq, and, sql, gte, lte, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  attendanceRecords,
  classSessions,
  classes,
  classEnrollments,
  students,
  subjects,
  teachers,
  organizations,
} from "@classflow/db";
import { bulkAttendanceSchema } from "@classflow/core";
import type { Env } from "../env";
import type { ApiVariables } from "../middleware/session";
import { requireAuth, requirePerm } from "../middleware/guard";
import { ok, notFound, badRequest, nowIso, todayColombo } from "../lib/http";
import { audit } from "../lib/audit";
import { uuid } from "../lib/crypto";
import { notifyStudentGuardians } from "../services/notify";
import { materializeSessions } from "./classes";

export const attendanceRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

attendanceRoutes.use("*", requireAuth);

/** Sessions in a range (materializes scheduled ones first). */
attendanceRoutes.get("/sessions", requirePerm("attendance.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const q = new URL(c.req.url).searchParams;
  const from = q.get("from") ?? todayColombo();
  const to = q.get("to") ?? from;
  if (to >= todayColombo()) {
    await materializeSessions(db, member.orgId, from, to);
  }
  const rows = await db
    .select({
      session: classSessions,
      className: classes.name,
      subjectName: subjects.name,
      teacherName: teachers.fullName,
      present: sql<number>`(select count(*) from attendance_records ar where ar.session_id = ${classSessions.id} and ar.status = 'present')`,
      absent: sql<number>`(select count(*) from attendance_records ar where ar.session_id = ${classSessions.id} and ar.status = 'absent')`,
      late: sql<number>`(select count(*) from attendance_records ar where ar.session_id = ${classSessions.id} and ar.status = 'late')`,
      excused: sql<number>`(select count(*) from attendance_records ar where ar.session_id = ${classSessions.id} and ar.status = 'excused')`,
      enrolled: sql<number>`(select count(*) from class_enrollments ce where ce.class_id = ${classSessions.classId} and ce.status = 'active')`,
    })
    .from(classSessions)
    .innerJoin(classes, eq(classSessions.classId, classes.id))
    .innerJoin(subjects, eq(classes.subjectId, subjects.id))
    .leftJoin(teachers, eq(classes.teacherId, teachers.id))
    .where(and(eq(classSessions.orgId, member.orgId), gte(classSessions.date, from), lte(classSessions.date, to)))
    .orderBy(classSessions.date, classSessions.startTime);
  return ok(rows.map((r) => ({ ...r.session, className: r.className, subjectName: r.subjectName, teacherName: r.teacherName, counts: { present: r.present, absent: r.absent, late: r.late, excused: r.excused }, enrolled: r.enrolled })));
});

/** Session detail with roster + existing records for the marking UI. */
attendanceRoutes.get("/sessions/:id", requirePerm("attendance.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const session = await db
    .select({ session: classSessions, className: classes.name, subjectName: subjects.name })
    .from(classSessions)
    .innerJoin(classes, eq(classSessions.classId, classes.id))
    .innerJoin(subjects, eq(classes.subjectId, subjects.id))
    .where(and(eq(classSessions.id, c.req.param("id")), eq(classSessions.orgId, member.orgId)))
    .limit(1);
  if (!session[0]) return notFound("Session not found");
  const roster = await db
    .select({ studentId: students.id, fullName: students.fullName, studentNo: students.studentNo, photoKey: students.photoKey })
    .from(classEnrollments)
    .innerJoin(students, eq(classEnrollments.studentId, students.id))
    .where(and(eq(classEnrollments.classId, session[0].session.classId), eq(classEnrollments.status, "active")))
    .orderBy(students.fullName);
  const records = await db.select().from(attendanceRecords).where(eq(attendanceRecords.sessionId, session[0].session.id));
  return ok({
    session: { ...session[0].session, className: session[0].className, subjectName: session[0].subjectName },
    roster: roster.map((s) => ({ ...s, record: records.find((r) => r.studentId === s.studentId) ?? null })),
  });
});

/** Bulk record attendance (idempotent upsert per student). */
attendanceRoutes.post("/sessions/:id/records", requirePerm("attendance.record"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const session = await db
    .select()
    .from(classSessions)
    .where(and(eq(classSessions.id, c.req.param("id")), eq(classSessions.orgId, member.orgId)))
    .limit(1);
  if (!session[0]) return notFound("Session not found");
  const body = bulkAttendanceSchema.parse(await c.req.json());
  const enrolled = await db
    .select({ studentId: classEnrollments.studentId })
    .from(classEnrollments)
    .where(and(eq(classEnrollments.classId, session[0].classId), eq(classEnrollments.status, "active")));
  const enrolledIds = new Set(enrolled.map((e) => e.studentId));
  const now = nowIso();
  const absentStudentIds: string[] = [];
  for (const rec of body.records) {
    if (!enrolledIds.has(rec.studentId)) continue;
    if (rec.status === "absent") absentStudentIds.push(rec.studentId);
    const existing = await db
      .select({ id: attendanceRecords.id })
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.sessionId, session[0].id), eq(attendanceRecords.studentId, rec.studentId)))
      .limit(1);
    if (existing[0]) {
      await db
        .update(attendanceRecords)
        .set({ status: rec.status, note: rec.note ?? null, updatedAt: now })
        .where(eq(attendanceRecords.id, existing[0].id));
    } else {
      await db.insert(attendanceRecords).values({
        id: uuid(),
        orgId: member.orgId,
        sessionId: session[0].id,
        classId: session[0].classId,
        studentId: rec.studentId,
        status: rec.status,
        note: rec.note ?? null,
        recordedBy: user.id,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  await db.update(classSessions).set({ status: "completed" }).where(eq(classSessions.id, session[0].id));
  await audit(db, {
    orgId: member.orgId,
    actorUserId: user.id,
    action: "ATTENDANCE_RECORDED",
    entity: "class_session",
    entityId: session[0].id,
    metadata: { count: body.records.length },
  });
  // Optional parent absence notifications
  if (absentStudentIds.length && c.req.query("notify") === "1") {
    const cls = await db.select().from(classes).where(eq(classes.id, session[0].classId)).limit(1);
    await notifyStudentGuardians(db, c.env, {
      orgId: member.orgId,
      studentIds: absentStudentIds,
      type: "attendance_absent",
      title: "Absence recorded",
      body: `Your child was marked absent from ${cls[0]?.name ?? "class"} on ${session[0].date}.`,
      actionUrl: "/parent",
    });
  }
  return ok({ recorded: body.records.length });
});

attendanceRoutes.patch("/records/:recordId", requirePerm("attendance.update"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = z.object({ status: z.enum(["present", "absent", "late", "excused"]), note: z.string().optional() }).parse(await c.req.json());
  const rows = await db.select().from(attendanceRecords).where(and(eq(attendanceRecords.id, c.req.param("recordId")), eq(attendanceRecords.orgId, member.orgId))).limit(1);
  if (!rows[0]) return notFound();
  await db.update(attendanceRecords).set({ status: body.status, note: body.note ?? null, updatedAt: nowIso() }).where(eq(attendanceRecords.id, rows[0].id));
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "ATTENDANCE_UPDATED", entity: "attendance_record", entityId: rows[0].id });
  return ok({ updated: true });
});

// ---------- Analytics ----------

attendanceRoutes.get("/analytics/student/:studentId", requirePerm("attendance.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const studentId = c.req.param("studentId");
  const st = await db.select().from(students).where(and(eq(students.id, studentId), eq(students.orgId, member.orgId))).limit(1);
  if (!st[0]) return notFound("Student not found");
  const since = new Date(Date.now() - 90 * 86400e3).toISOString().slice(0, 10);
  const rows = await db
    .select({ status: attendanceRecords.status, n: sql<number>`count(*)` })
    .from(attendanceRecords)
    .innerJoin(classSessions, eq(attendanceRecords.sessionId, classSessions.id))
    .where(and(eq(attendanceRecords.studentId, studentId), gte(classSessions.date, since)))
    .groupBy(attendanceRecords.status);
  const counts = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const total = rows.reduce((a, r) => a + r.n, 0);
  const attended = (counts.present ?? 0) + (counts.late ?? 0);
  return ok({
    studentId,
    windowDays: 90,
    total,
    counts,
    rate: total ? Math.round((attended / total) * 1000) / 10 : null,
  });
});

attendanceRoutes.get("/analytics/class/:classId", requirePerm("attendance.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const classId = c.req.param("classId");
  const since = new Date(Date.now() - 90 * 86400e3).toISOString().slice(0, 10);
  const rows = await db
    .select({ status: attendanceRecords.status, n: sql<number>`count(*)` })
    .from(attendanceRecords)
    .innerJoin(classSessions, eq(attendanceRecords.sessionId, classSessions.id))
    .where(and(eq(attendanceRecords.classId, classId), eq(attendanceRecords.orgId, member.orgId), gte(classSessions.date, since)))
    .groupBy(attendanceRecords.status);
  const counts = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const total = rows.reduce((a, r) => a + r.n, 0);
  const attended = (counts.present ?? 0) + (counts.late ?? 0);
  return ok({ classId, windowDays: 90, total, counts, rate: total ? Math.round((attended / total) * 1000) / 10 : null });
});

/** Students below the org attendance threshold (last 30 days). */
attendanceRoutes.get("/analytics/at-risk", requirePerm("attendance.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const org = await db.select({ t: organizations.attendanceAlertThreshold }).from(organizations).where(eq(organizations.id, member.orgId)).limit(1);
  const threshold = org[0]?.t ?? 80;
  const since = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
  const rows = await db
    .select({
      studentId: attendanceRecords.studentId,
      studentName: students.fullName,
      studentNo: students.studentNo,
      total: sql<number>`count(*)`,
      attended: sql<number>`sum(case when ${attendanceRecords.status} in ('present','late') then 1 else 0 end)`,
      absences: sql<number>`sum(case when ${attendanceRecords.status} = 'absent' then 1 else 0 end)`,
    })
    .from(attendanceRecords)
    .innerJoin(students, eq(attendanceRecords.studentId, students.id))
    .innerJoin(classSessions, eq(attendanceRecords.sessionId, classSessions.id))
    .where(and(eq(attendanceRecords.orgId, member.orgId), gte(classSessions.date, since)))
    .groupBy(attendanceRecords.studentId);
  const atRisk = rows
    .map((r) => ({ ...r, rate: r.total ? Math.round((r.attended / r.total) * 1000) / 10 : 0 }))
    .filter((r) => r.rate < threshold)
    .sort((a, b) => a.rate - b.rate);
  return ok({ threshold, students: atRisk });
});
