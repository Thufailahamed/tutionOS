import { Hono } from "hono";
import { eq, and, isNull, sql, desc, asc, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  students,
  guardians,
  studentGuardians,
  classes,
  subjects,
  classSessions,
  classEnrollments,
  attendanceRecords,
  studentFees,
  payments,
  examResults,
  exams,
  homework,
  homeworkSubmissions,
  learningMaterials,
  materialAccess,
  recordedLessons,
  announcements,
  files,
  organizations,
  grades,
  certificates,
  type Database,
} from "@classflow/db";
import type { Env } from "../env";
import type { ApiVariables, SessionUser } from "../middleware/session";
import { requireAuth } from "../middleware/guard";
import { ok, notFound, forbidden, badRequest, nowIso, todayColombo } from "../lib/http";
import { uuid } from "../lib/crypto";
import { audit } from "../lib/audit";

/**
 * Portal routes for student and guardian users.
 * Every query is scoped to students linked to the caller's user account —
 * a student sees only their own data, a guardian only linked children's.
 */
export const portalRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

portalRoutes.use("*", requireAuth);

type Scope = { orgId: string; studentIds: string[]; role: "student" | "guardian" };

async function resolveScope(db: Database, user: SessionUser, requestedStudentId?: string): Promise<Scope[]> {
  // student accounts
  const myStudents = await db
    .select({ id: students.id, orgId: students.orgId })
    .from(students)
    .where(and(eq(students.userId, user.id), isNull(students.deletedAt)));
  const scopes: Scope[] = myStudents.map((s) => ({ orgId: s.orgId, studentIds: [s.id], role: "student" as const }));
  // guardian accounts
  const myGuardians = await db
    .select({ id: guardians.id, orgId: guardians.orgId })
    .from(guardians)
    .where(eq(guardians.userId, user.id));
  for (const g of myGuardians) {
    const links = await db
      .select({ studentId: studentGuardians.studentId })
      .from(studentGuardians)
      .where(eq(studentGuardians.guardianId, g.id));
    if (links.length) {
      scopes.push({ orgId: g.orgId, studentIds: links.map((l) => l.studentId), role: "guardian" });
    }
  }
  if (requestedStudentId) {
    const match = scopes.find((s) => s.studentIds.includes(requestedStudentId));
    if (!match) forbidden("You do not have access to this student");
    return [match!];
  }
  return scopes;
}

/** Overview of the caller's linked children/self. */
portalRoutes.get("/me", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const scopes = await resolveScope(db, user);
  const out = [];
  for (const scope of scopes) {
    const rows = await db
      .select({ student: students, orgName: organizations.name, gradeName: grades.name })
      .from(students)
      .innerJoin(organizations, eq(students.orgId, organizations.id))
      .leftJoin(grades, eq(students.gradeId, grades.id))
      .where(inArray(students.id, scope.studentIds));
    for (const r of rows) out.push({ ...r.student, orgName: r.orgName, gradeName: r.gradeName, portalRole: scope.role });
  }
  return ok({ user, children: out });
});

/** Per-student dashboard: next class, attendance %, latest result, homework, fees. */
portalRoutes.get("/student/:studentId/summary", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const studentId = c.req.param("studentId");
  const [scope] = await resolveScope(db, user, studentId);
  if (!scope) return forbidden();
  const today = todayColombo();

  const enrollments = await db
    .select({ classId: classEnrollments.classId })
    .from(classEnrollments)
    .where(and(eq(classEnrollments.studentId, studentId), eq(classEnrollments.status, "active")));
  const classIds = enrollments.map((e) => e.classId);

  const nextSession = classIds.length
    ? await db
        .select({ s: classSessions, className: classes.name, subjectName: subjects.name })
        .from(classSessions)
        .innerJoin(classes, eq(classSessions.classId, classes.id))
        .innerJoin(subjects, eq(classes.subjectId, subjects.id))
        .where(and(inArray(classSessions.classId, classIds), gte(classSessions.date, today), sql`${classSessions.status} != 'cancelled'`))
        .orderBy(asc(classSessions.date), asc(classSessions.startTime))
        .limit(1)
    : [];

  const att = await db
    .select({
      total: sql<number>`count(*)`,
      attended: sql<number>`sum(case when ${attendanceRecords.status} in ('present','late') then 1 else 0 end)`,
    })
    .from(attendanceRecords)
    .where(eq(attendanceRecords.studentId, studentId));
  const attRate = att[0]?.total ? Math.round((att[0].attended / att[0].total) * 1000) / 10 : null;

  const latestResult = await db
    .select({ r: examResults, title: exams.title, date: exams.date, maxMarks: exams.maxMarks })
    .from(examResults)
    .innerJoin(exams, eq(examResults.examId, exams.id))
    .where(and(eq(examResults.studentId, studentId), eq(exams.status, "published")))
    .orderBy(desc(exams.date))
    .limit(1);

  const pendingHw = await db
    .select({ n: sql<number>`count(*)` })
    .from(homeworkSubmissions)
    .where(and(eq(homeworkSubmissions.studentId, studentId), inArray(homeworkSubmissions.status, ["assigned", "viewed"])));

  const upcomingExam = classIds.length
    ? await db
        .select({ title: exams.title, date: exams.date })
        .from(exams)
        .innerJoin(classes, eq(exams.classId, classes.id))
        .where(and(inArray(exams.classId, classIds), gte(exams.date, today), isNull(exams.deletedAt)))
        .orderBy(asc(exams.date))
        .limit(1)
    : [];

  const outstanding = await db
    .select({ total: sql<number>`coalesce(sum(${studentFees.amountCents} - ${studentFees.discountCents} - ${studentFees.paidCents}),0)` })
    .from(studentFees)
    .where(and(eq(studentFees.studentId, studentId), inArray(studentFees.status, ["pending", "partial", "overdue"])));

  return ok({
    nextClass: nextSession[0] ? { ...nextSession[0].s, className: nextSession[0].className, subjectName: nextSession[0].subjectName } : null,
    attendanceRate: attRate,
    latestResult: latestResult[0] ? { title: latestResult[0].title, date: latestResult[0].date, marks: latestResult[0].r.marks, maxMarks: latestResult[0].maxMarks, grade: latestResult[0].r.grade, percentage: latestResult[0].r.percentage } : null,
    pendingHomework: pendingHw[0]?.n ?? 0,
    upcomingExam: upcomingExam[0] ?? null,
    outstandingCents: outstanding[0]?.total ?? 0,
  });
});

portalRoutes.get("/student/:studentId/attendance", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const studentId = c.req.param("studentId");
  await resolveScope(db, user, studentId);
  const rows = await db
    .select({ r: attendanceRecords, date: classSessions.date, className: classes.name, subjectName: subjects.name })
    .from(attendanceRecords)
    .innerJoin(classSessions, eq(attendanceRecords.sessionId, classSessions.id))
    .innerJoin(classes, eq(attendanceRecords.classId, classes.id))
    .innerJoin(subjects, eq(classes.subjectId, subjects.id))
    .where(eq(attendanceRecords.studentId, studentId))
    .orderBy(desc(classSessions.date))
    .limit(90);
  return ok(rows.map((r) => ({ date: r.date, className: r.className, subjectName: r.subjectName, status: r.r.status, note: r.r.note })));
});

portalRoutes.get("/student/:studentId/results", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const studentId = c.req.param("studentId");
  await resolveScope(db, user, studentId);
  const rows = await db
    .select({ r: examResults, title: exams.title, type: exams.type, date: exams.date, maxMarks: exams.maxMarks, className: classes.name, subjectName: subjects.name })
    .from(examResults)
    .innerJoin(exams, eq(examResults.examId, exams.id))
    .innerJoin(classes, eq(exams.classId, classes.id))
    .innerJoin(subjects, eq(classes.subjectId, subjects.id))
    .where(and(eq(examResults.studentId, studentId), eq(exams.status, "published")))
    .orderBy(desc(exams.date));
  return ok(rows.map((r) => ({ title: r.title, type: r.type, date: r.date, className: r.className, subjectName: r.subjectName, marks: r.r.marks, maxMarks: r.maxMarks, percentage: r.r.percentage, grade: r.r.grade, rank: r.r.rank, remarks: r.r.remarks })));
});

portalRoutes.get("/student/:studentId/fees", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const studentId = c.req.param("studentId");
  await resolveScope(db, user, studentId);
  const fees = await db
    .select()
    .from(studentFees)
    .where(eq(studentFees.studentId, studentId))
    .orderBy(desc(studentFees.dueDate));
  const pays = await db
    .select()
    .from(payments)
    .where(eq(payments.studentId, studentId))
    .orderBy(desc(payments.paidAt));
  const outstanding = fees.filter((f) => ["pending", "partial", "overdue"].includes(f.status)).reduce((a, f) => a + (f.amountCents - f.discountCents - f.paidCents), 0);
  return ok({ fees, payments: pays, outstandingCents: outstanding });
});

portalRoutes.get("/student/:studentId/homework", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const studentId = c.req.param("studentId");
  await resolveScope(db, user, studentId);
  const rows = await db
    .select({ sub: homeworkSubmissions, hw: homework, className: classes.name })
    .from(homeworkSubmissions)
    .innerJoin(homework, eq(homeworkSubmissions.homeworkId, homework.id))
    .innerJoin(classes, eq(homework.classId, classes.id))
    .where(and(eq(homeworkSubmissions.studentId, studentId), isNull(homework.deletedAt)))
    .orderBy(desc(homework.dueAt));
  return ok(rows.map((r) => ({
    submissionId: r.sub.id,
    homeworkId: r.hw.id,
    title: r.hw.title,
    description: r.hw.description,
    className: r.className,
    dueAt: r.hw.dueAt,
    maxMarks: r.hw.maxMarks,
    attachments: JSON.parse(r.hw.attachmentsJson || "[]"),
    status: r.sub.status,
    marks: r.sub.marks,
    feedback: r.sub.feedback,
    files: JSON.parse(r.sub.filesJson || "[]"),
    submittedAt: r.sub.submittedAt,
  })));
});

/** Student views homework → mark VIEWED; submits file keys → SUBMITTED/LATE. */
portalRoutes.post("/student/:studentId/homework/:submissionId/view", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const studentId = c.req.param("studentId");
  await resolveScope(db, user, studentId);
  const rows = await db.select().from(homeworkSubmissions).where(and(eq(homeworkSubmissions.id, c.req.param("submissionId")), eq(homeworkSubmissions.studentId, studentId))).limit(1);
  if (!rows[0]) return notFound();
  if (rows[0].status === "assigned") {
    await db.update(homeworkSubmissions).set({ status: "viewed", viewedAt: nowIso() }).where(eq(homeworkSubmissions.id, rows[0].id));
  }
  return ok({ viewed: true });
});

portalRoutes.post("/student/:studentId/homework/:submissionId/submit", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const studentId = c.req.param("studentId");
  await resolveScope(db, user, studentId);
  const body = z.object({ fileIds: z.array(z.string()).max(5) }).parse(await c.req.json());
  const rows = await db
    .select({ sub: homeworkSubmissions, hw: homework })
    .from(homeworkSubmissions)
    .innerJoin(homework, eq(homeworkSubmissions.homeworkId, homework.id))
    .where(and(eq(homeworkSubmissions.id, c.req.param("submissionId")), eq(homeworkSubmissions.studentId, studentId)))
    .limit(1);
  if (!rows[0]) return notFound();
  // validate file keys belong to this org
  const fileRows = await db.select().from(files).where(and(inArray(files.id, body.fileIds), eq(files.orgId, rows[0].hw.orgId)));
  const late = rows[0].hw.dueAt < nowIso();
  await db.update(homeworkSubmissions).set({
    filesJson: JSON.stringify(fileRows.map((f) => f.key)),
    status: late ? "late" : "submitted",
    submittedAt: nowIso(),
  }).where(eq(homeworkSubmissions.id, rows[0].sub.id));
  await audit(db, { orgId: rows[0].hw.orgId, actorUserId: user.id, action: "HOMEWORK_SUBMITTED", entity: "homework_submission", entityId: rows[0].sub.id });
  return ok({ submitted: true, late });
});

portalRoutes.get("/student/:studentId/schedule", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const studentId = c.req.param("studentId");
  await resolveScope(db, user, studentId);
  const today = todayColombo();
  const in30 = new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);
  const enrollments = await db.select({ classId: classEnrollments.classId }).from(classEnrollments).where(and(eq(classEnrollments.studentId, studentId), eq(classEnrollments.status, "active")));
  const classIds = enrollments.map((e) => e.classId);
  if (!classIds.length) return ok([]);
  const rows = await db
    .select({ s: classSessions, className: classes.name, subjectName: subjects.name, room: classes.room, mode: classes.mode })
    .from(classSessions)
    .innerJoin(classes, eq(classSessions.classId, classes.id))
    .innerJoin(subjects, eq(classes.subjectId, subjects.id))
    .where(and(inArray(classSessions.classId, classIds), gte(classSessions.date, today), sql`${classSessions.date} <= ${in30}`))
    .orderBy(asc(classSessions.date), asc(classSessions.startTime));
  return ok(rows.map((r) => ({ ...r.s, className: r.className, subjectName: r.subjectName, room: r.room, mode: r.mode })));
});

portalRoutes.get("/student/:studentId/classes", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const studentId = c.req.param("studentId");
  await resolveScope(db, user, studentId);
  const rows = await db
    .select({ e: classEnrollments, className: classes.name, subjectName: subjects.name, mode: classes.mode, medium: classes.medium, feeCents: classes.feeCents, feePeriod: classes.feePeriod })
    .from(classEnrollments)
    .innerJoin(classes, eq(classEnrollments.classId, classes.id))
    .innerJoin(subjects, eq(classes.subjectId, subjects.id))
    .where(and(eq(classEnrollments.studentId, studentId), eq(classEnrollments.status, "active")));
  return ok(rows.map((r) => ({ ...r.e, className: r.className, subjectName: r.subjectName, mode: r.mode, medium: r.medium, feeCents: r.feeCents, feePeriod: r.feePeriod })));
});

portalRoutes.get("/student/:studentId/materials", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const studentId = c.req.param("studentId");
  await resolveScope(db, user, studentId);
  const enrollments = await db.select({ classId: classEnrollments.classId }).from(classEnrollments).where(and(eq(classEnrollments.studentId, studentId), eq(classEnrollments.status, "active")));
  const classIds = enrollments.map((e) => e.classId);
  if (!classIds.length) return ok([]);
  const mats = await db.select().from(learningMaterials).where(and(inArray(learningMaterials.classId, classIds), isNull(learningMaterials.deletedAt)));
  const grants = await db.select().from(materialAccess).where(eq(materialAccess.studentId, studentId));
  const grantSet = new Set(grants.map((g) => g.materialId));
  const fileRows = await db.select().from(files);
  const fileByKey = new Map(fileRows.map((f) => [f.key, f]));
  const visible = mats.filter((m) => {
    if (m.visibility === "students") return grantSet.has(m.id);
    return true; // all/class/batch scoped to enrolled classes
  });
  return ok(visible.map((m) => ({ ...m, file: m.fileKey ? fileByKey.get(m.fileKey) ?? null : null })));
});

portalRoutes.get("/student/:studentId/lessons", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const studentId = c.req.param("studentId");
  await resolveScope(db, user, studentId);
  const enrollments = await db.select({ classId: classEnrollments.classId }).from(classEnrollments).where(and(eq(classEnrollments.studentId, studentId), eq(classEnrollments.status, "active")));
  const classIds = enrollments.map((e) => e.classId);
  if (!classIds.length) return ok([]);
  const lessons = await db.select().from(recordedLessons).where(and(inArray(recordedLessons.classId, classIds), isNull(recordedLessons.deletedAt)));
  const fileRows = await db.select().from(files);
  const fileByKey = new Map(fileRows.map((f) => [f.key, f]));
  return ok(lessons.map((l) => ({ ...l, file: fileByKey.get(l.fileKey) ?? null })));
});

portalRoutes.get("/student/:studentId/announcements", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const studentId = c.req.param("studentId");
  const [scope] = await resolveScope(db, user, studentId);
  if (!scope) return forbidden();
  const rows = await db
    .select()
    .from(announcements)
    .where(and(eq(announcements.orgId, scope.orgId), isNull(announcements.deletedAt)))
    .orderBy(desc(announcements.createdAt))
    .limit(30);
  const enrollments = await db.select({ classId: classEnrollments.classId }).from(classEnrollments).where(and(eq(classEnrollments.studentId, studentId), eq(classEnrollments.status, "active")));
  const classIds = new Set(enrollments.map((e) => e.classId));
  const visible = rows.filter((a) => {
    if (a.audience === "all") return true;
    const targeted = JSON.parse(a.studentIdsJson || "[]") as string[];
    if (targeted.includes(studentId)) return true;
    if (a.classId && classIds.has(a.classId)) return true;
    return false;
  });
  return ok(visible);
});

portalRoutes.get("/student/:studentId/certificates", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const studentId = c.req.param("studentId");
  await resolveScope(db, user, studentId);
  const rows = await db.select().from(certificates).where(eq(certificates.studentId, studentId)).orderBy(desc(certificates.issuedAt));
  return ok(rows);
});
