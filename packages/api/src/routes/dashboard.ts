import { Hono } from "hono";
import { eq, and, isNull, sql, desc, gte, lte, inArray, ne } from "drizzle-orm";
import {
  students,
  classes,
  classSessions,
  classEnrollments,
  attendanceRecords,
  studentFees,
  payments,
  exams,
  examResults,
  homeworkSubmissions,
  subjects,
  teachers,
  organizations,
  auditLogs,
  users,
} from "@classflow/db";
import type { Env } from "../env";
import type { ApiVariables } from "../middleware/session";
import { requireAuth, requirePerm, requireMember } from "../middleware/guard";
import { ok, todayColombo } from "../lib/http";
import { materializeSessions } from "./classes";

export const dashboardRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

dashboardRoutes.use("*", requireAuth, requireMember);

/** Premium teacher dashboard: all numbers from real data. */
dashboardRoutes.get("/summary", async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const orgId = member.orgId;
  const today = todayColombo();
  const monthStart = `${today.slice(0, 7)}-01`;
  const in30 = new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);
  const ago30 = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
  await materializeSessions(db, orgId, today, in30);

  const [
    studentCount,
    newStudents,
    todaySessions,
    upcomingSessions,
    upcomingExams,
    outstanding,
    monthRevenue,
    recentPayments,
    recentRegistrations,
    attendanceAgg,
    pendingHomework,
  ] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(students).where(and(eq(students.orgId, orgId), isNull(students.deletedAt), eq(students.status, "active"))),
    db.select({ n: sql<number>`count(*)` }).from(students).where(and(eq(students.orgId, orgId), gte(students.createdAt, ago30))),
    db
      .select({ session: classSessions, className: classes.name, subjectName: subjects.name })
      .from(classSessions)
      .innerJoin(classes, eq(classSessions.classId, classes.id))
      .innerJoin(subjects, eq(classes.subjectId, subjects.id))
      .where(and(eq(classSessions.orgId, orgId), eq(classSessions.date, today)))
      .orderBy(classSessions.startTime),
    db
      .select({ session: classSessions, className: classes.name, subjectName: subjects.name })
      .from(classSessions)
      .innerJoin(classes, eq(classSessions.classId, classes.id))
      .innerJoin(subjects, eq(classes.subjectId, subjects.id))
      .where(and(eq(classSessions.orgId, orgId), gte(classSessions.date, today), lte(classSessions.date, in30), ne(classSessions.status, "cancelled")))
      .orderBy(classSessions.date, classSessions.startTime)
      .limit(10),
    db
      .select({ exam: exams, className: classes.name })
      .from(exams)
      .innerJoin(classes, eq(exams.classId, classes.id))
      .where(and(eq(exams.orgId, orgId), gte(exams.date, today), isNull(exams.deletedAt)))
      .orderBy(exams.date)
      .limit(10),
    db
      .select({ total: sql<number>`coalesce(sum(${studentFees.amountCents} - ${studentFees.discountCents} - ${studentFees.paidCents}),0)`, n: sql<number>`count(distinct ${studentFees.studentId})` })
      .from(studentFees)
      .where(and(eq(studentFees.orgId, orgId), inArray(studentFees.status, ["pending", "partial", "overdue"]))),
    db
      .select({ total: sql<number>`coalesce(sum(${payments.amountCents} - ${payments.refundedCents}),0)` })
      .from(payments)
      .where(and(eq(payments.orgId, orgId), gte(payments.paidAt, monthStart), ne(payments.status, "failed"))),
    db
      .select({ payment: payments, studentName: students.fullName })
      .from(payments)
      .innerJoin(students, eq(payments.studentId, students.id))
      .where(eq(payments.orgId, orgId))
      .orderBy(desc(payments.paidAt))
      .limit(8),
    db
      .select({ id: students.id, fullName: students.fullName, studentNo: students.studentNo, createdAt: students.createdAt })
      .from(students)
      .where(and(eq(students.orgId, orgId), isNull(students.deletedAt)))
      .orderBy(desc(students.createdAt))
      .limit(8),
    db
      .select({
        total: sql<number>`count(*)`,
        attended: sql<number>`sum(case when ${attendanceRecords.status} in ('present','late') then 1 else 0 end)`,
      })
      .from(attendanceRecords)
      .innerJoin(classSessions, eq(attendanceRecords.sessionId, classSessions.id))
      .where(and(eq(attendanceRecords.orgId, orgId), gte(classSessions.date, ago30))),
    db
      .select({ n: sql<number>`count(*)` })
      .from(homeworkSubmissions)
      .where(and(eq(homeworkSubmissions.orgId, orgId), inArray(homeworkSubmissions.status, ["submitted", "late"]))),
  ]);

  const attTotal = attendanceAgg[0]?.total ?? 0;
  const attRate = attTotal ? Math.round(((attendanceAgg[0]?.attended ?? 0) / attTotal) * 1000) / 10 : null;

  return ok({
    greeting: {
      students: studentCount[0]?.n ?? 0,
      newStudents30d: newStudents[0]?.n ?? 0,
      todayClasses: todaySessions.length,
      attendanceRate30d: attRate,
      outstandingCents: outstanding[0]?.total ?? 0,
      outstandingStudents: outstanding[0]?.n ?? 0,
      monthRevenueCents: monthRevenue[0]?.total ?? 0,
      pendingHomeworkSubmissions: pendingHomework[0]?.n ?? 0,
      upcomingExams: upcomingExams.length,
    },
    todaySessions: todaySessions.map((r) => ({ ...r.session, className: r.className, subjectName: r.subjectName })),
    upcoming: upcomingSessions.map((r) => ({ ...r.session, className: r.className, subjectName: r.subjectName })),
    upcomingExams: upcomingExams.map((r) => ({ ...r.exam, className: r.className })),
    recentPayments: recentPayments.map((r) => ({ ...r.payment, studentName: r.studentName })),
    recentRegistrations,
  });
});

/** Weekly schedule for calendar view (materializes first). */
dashboardRoutes.get("/calendar", async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const q = new URL(c.req.url).searchParams;
  const from = q.get("from") ?? todayColombo();
  const to = q.get("to") ?? new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10);
  await materializeSessions(db, member.orgId, from, to);
  const [sessions, examRows] = await Promise.all([
    db
      .select({ session: classSessions, className: classes.name, subjectName: subjects.name, teacherName: teachers.fullName, room: classes.room, mode: classes.mode })
      .from(classSessions)
      .innerJoin(classes, eq(classSessions.classId, classes.id))
      .innerJoin(subjects, eq(classes.subjectId, subjects.id))
      .leftJoin(teachers, eq(classes.teacherId, teachers.id))
      .where(and(eq(classSessions.orgId, member.orgId), gte(classSessions.date, from), lte(classSessions.date, to)))
      .orderBy(classSessions.date, classSessions.startTime),
    db
      .select({ exam: exams, className: classes.name })
      .from(exams)
      .innerJoin(classes, eq(exams.classId, classes.id))
      .where(and(eq(exams.orgId, member.orgId), gte(exams.date, from), lte(exams.date, to), isNull(exams.deletedAt))),
  ]);
  const events = [
    ...sessions.map((r) => ({
      kind: "session" as const,
      id: r.session.id,
      date: r.session.date,
      startTime: r.session.startTime,
      endTime: r.session.endTime,
      title: r.className,
      subtitle: r.subjectName,
      status: r.session.status,
      teacher: r.teacherName,
      room: r.room,
      mode: r.mode,
    })),
    ...examRows.map((r) => ({
      kind: "exam" as const,
      id: r.exam.id,
      date: r.exam.date,
      startTime: null,
      endTime: null,
      title: r.exam.title,
      subtitle: r.className,
      status: r.exam.status,
      teacher: null,
      room: null,
      mode: null,
    })),
  ];
  return ok(events);
});

// ---------- Reports ----------

dashboardRoutes.get("/reports/attendance", requirePerm("reports.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const q = new URL(c.req.url).searchParams;
  const from = q.get("from") ?? new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
  const to = q.get("to") ?? todayColombo();
  const rows = await db
    .select({
      studentId: attendanceRecords.studentId,
      studentName: students.fullName,
      studentNo: students.studentNo,
      total: sql<number>`count(*)`,
      present: sql<number>`sum(case when ${attendanceRecords.status}='present' then 1 else 0 end)`,
      absent: sql<number>`sum(case when ${attendanceRecords.status}='absent' then 1 else 0 end)`,
      late: sql<number>`sum(case when ${attendanceRecords.status}='late' then 1 else 0 end)`,
      excused: sql<number>`sum(case when ${attendanceRecords.status}='excused' then 1 else 0 end)`,
    })
    .from(attendanceRecords)
    .innerJoin(students, eq(attendanceRecords.studentId, students.id))
    .innerJoin(classSessions, eq(attendanceRecords.sessionId, classSessions.id))
    .where(and(eq(attendanceRecords.orgId, member.orgId), gte(classSessions.date, from), lte(classSessions.date, to)))
    .groupBy(attendanceRecords.studentId)
    .orderBy(students.fullName);
  if (q.get("format") === "csv") {
    const header = "Student No,Name,Total,Present,Absent,Late,Excused,Rate\n";
    const body = rows
      .map((r) => `${r.studentNo},${csvEscape(r.studentName)},${r.total},${r.present},${r.absent},${r.late},${r.excused},${r.total ? Math.round(((r.present + r.late) / r.total) * 1000) / 10 : 0}%`)
      .join("\n");
    return new Response(header + body, { headers: { "content-type": "text/csv", "content-disposition": `attachment; filename="attendance-${from}-${to}.csv"` } });
  }
  return ok({ from, to, rows });
});

dashboardRoutes.get("/reports/fees", requirePerm("reports.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const q = new URL(c.req.url).searchParams;
  const from = q.get("from") ?? todayColombo().slice(0, 7) + "-01";
  const to = q.get("to") ?? todayColombo();
  const collections = await db
    .select({
      method: payments.method,
      n: sql<number>`count(*)`,
      total: sql<number>`sum(${payments.amountCents} - ${payments.refundedCents})`,
    })
    .from(payments)
    .where(and(eq(payments.orgId, member.orgId), gte(payments.paidAt, from), lte(payments.paidAt, `${to}T23:59:59Z`), ne(payments.status, "failed")))
    .groupBy(payments.method);
  const outstandingRows = await db
    .select({ total: sql<number>`coalesce(sum(${studentFees.amountCents} - ${studentFees.discountCents} - ${studentFees.paidCents}),0)` })
    .from(studentFees)
    .where(and(eq(studentFees.orgId, member.orgId), inArray(studentFees.status, ["pending", "partial", "overdue"])));
  return ok({ from, to, byMethod: collections, collectedCents: collections.reduce((a, r) => a + (r.total ?? 0), 0), outstandingCents: outstandingRows[0]?.total ?? 0 });
});

dashboardRoutes.get("/reports/exam-performance", requirePerm("reports.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const examId = new URL(c.req.url).searchParams.get("examId");
  const rows = await db
    .select({
      examId: exams.id,
      title: exams.title,
      date: exams.date,
      className: classes.name,
      subjectName: subjects.name,
      n: sql<number>`count(exam_results.id)`,
      avg: sql<number>`avg(exam_results.marks)`,
      maxMark: sql<number>`max(exam_results.marks)`,
      minMark: sql<number>`min(exam_results.marks)`,
      maxMarks: exams.maxMarks,
    })
    .from(examResults)
    .innerJoin(exams, eq(examResults.examId, exams.id))
    .innerJoin(classes, eq(exams.classId, classes.id))
    .innerJoin(subjects, eq(classes.subjectId, subjects.id))
    .where(and(eq(examResults.orgId, member.orgId), examId ? eq(exams.id, examId) : sql`1=1`))
    .groupBy(exams.id)
    .orderBy(desc(exams.date));
  return ok(rows);
});

dashboardRoutes.get("/reports/enrollment", requirePerm("reports.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const rows = await db
    .select({
      classId: classes.id,
      className: classes.name,
      subjectName: subjects.name,
      teacherName: teachers.fullName,
      enrolled: sql<number>`count(case when ${classEnrollments.status}='active' then 1 end)`,
      capacity: classes.capacity,
      dropped: sql<number>`count(case when ${classEnrollments.status}='dropped' then 1 end)`,
    })
    .from(classEnrollments)
    .innerJoin(classes, eq(classEnrollments.classId, classes.id))
    .innerJoin(subjects, eq(classes.subjectId, subjects.id))
    .leftJoin(teachers, eq(classes.teacherId, teachers.id))
    .where(eq(classEnrollments.orgId, member.orgId))
    .groupBy(classes.id);
  return ok(rows);
});

dashboardRoutes.get("/reports/teacher-performance", requirePerm("reports.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const rows = await db
    .select({
      teacherId: teachers.id,
      teacherName: teachers.fullName,
      classCount: sql<number>`count(distinct ${classes.id})`,
      studentCount: sql<number>`(select count(*) from class_enrollments ce where ce.class_id in (select id from classes c2 where c2.teacher_id = ${teachers.id}) and ce.status='active')`,
      revenue: sql<number>`coalesce((select sum(p.amount_cents - p.refunded_cents) from payments p join class_enrollments ce2 on ce2.student_id = p.student_id join classes c3 on ce2.class_id = c3.id where c3.teacher_id = ${teachers.id} and p.status != 'failed'),0)`,
    })
    .from(teachers)
    .leftJoin(classes, eq(classes.teacherId, teachers.id))
    .where(and(eq(teachers.orgId, member.orgId), eq(teachers.status, "active")))
    .groupBy(teachers.id);
  return ok(rows);
});

dashboardRoutes.get("/export/:entity", requirePerm("reports.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const entity = c.req.param("entity");
  let csv = "";
  const now = todayColombo();
  if (entity === "students") {
    const rows = await db.select().from(students).where(and(eq(students.orgId, member.orgId), isNull(students.deletedAt))).orderBy(students.studentNo);
    csv = "Student No,Name,Phone,Email,School,Status,Created\n" + rows.map((r) => [r.studentNo, csvEscape(r.fullName), r.phone ?? "", r.email ?? "", csvEscape(r.school ?? ""), r.status, r.createdAt.slice(0, 10)].join(",")).join("\n");
  } else if (entity === "payments") {
    const rows = await db.select({ p: payments, name: students.fullName }).from(payments).innerJoin(students, eq(payments.studentId, students.id)).where(eq(payments.orgId, member.orgId)).orderBy(desc(payments.paidAt)).limit(5000);
    csv = "Receipt,Student,Amount (LKR),Method,Status,Paid At\n" + rows.map((r) => [r.p.receiptNo, csvEscape(r.name), ((r.p.amountCents - r.p.refundedCents) / 100).toFixed(2), r.p.method, r.p.status, r.p.paidAt].join(",")).join("\n");
  } else if (entity === "attendance") {
    const rows = await db
      .select({ r: attendanceRecords, name: students.fullName, date: classSessions.date, className: classes.name })
      .from(attendanceRecords)
      .innerJoin(students, eq(attendanceRecords.studentId, students.id))
      .innerJoin(classSessions, eq(attendanceRecords.sessionId, classSessions.id))
      .innerJoin(classes, eq(attendanceRecords.classId, classes.id))
      .where(eq(attendanceRecords.orgId, member.orgId))
      .orderBy(desc(classSessions.date))
      .limit(10000);
    csv = "Date,Class,Student,Status\n" + rows.map((r) => [r.date, csvEscape(r.className), csvEscape(r.name), r.r.status].join(",")).join("\n");
  } else {
    return ok({ error: "Unknown export entity" }, { status: 400 });
  }
  return new Response(csv, { headers: { "content-type": "text/csv", "content-disposition": `attachment; filename="${entity}-${now}.csv"` } });
});

function csvEscape(s: string) {
  return `"${(s ?? "").replace(/"/g, '""')}"`;
}

// ---------- Global search ----------

dashboardRoutes.get("/search", requireMember, async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const q = (new URL(c.req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return ok({ students: [], classes: [], payments: [], exams: [], materials: [] });
  const { like } = await import("drizzle-orm");
  const pattern = `%${q}%`;
  const { guardians, learningMaterials } = await import("@classflow/db");
  const [studs, cls, pays, exs, mats, gards] = await Promise.all([
    db.select({ id: students.id, name: students.fullName, no: students.studentNo, status: students.status }).from(students).where(and(eq(students.orgId, member.orgId), isNull(students.deletedAt), like(students.fullName, pattern))).limit(8),
    db.select({ id: classes.id, name: classes.name }).from(classes).where(and(eq(classes.orgId, member.orgId), isNull(classes.deletedAt), like(classes.name, pattern))).limit(8),
    db.select({ id: payments.id, receiptNo: payments.receiptNo, amount: payments.amountCents }).from(payments).where(and(eq(payments.orgId, member.orgId), like(payments.receiptNo, pattern))).limit(8),
    db.select({ id: exams.id, title: exams.title, date: exams.date }).from(exams).where(and(eq(exams.orgId, member.orgId), isNull(exams.deletedAt), like(exams.title, pattern))).limit(8),
    db.select({ id: learningMaterials.id, title: learningMaterials.title }).from(learningMaterials).where(and(eq(learningMaterials.orgId, member.orgId), like(learningMaterials.title, pattern))).limit(8),
    db.select({ id: guardians.id, name: guardians.fullName, phone: guardians.phone }).from(guardians).where(and(eq(guardians.orgId, member.orgId), like(guardians.fullName, pattern))).limit(8),
  ]);
  return ok({ students: studs, classes: cls, payments: pays, exams: exs, materials: mats, guardians: gards });
});

// ---------- Audit log ----------

dashboardRoutes.get("/audit", requirePerm("audit.view"), async (c) => {
  const member = c.get("member")!;
  const { limit, offset } = await import("../lib/http").then((m) => m.parsePagination(c.req.url, 50));
  const rows = await c
    .get("db")
    .select({ log: auditLogs, actorName: users.fullName })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorUserId, users.id))
    .where(eq(auditLogs.orgId, member.orgId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);
  return ok({ rows: rows.map((r) => ({ ...r.log, actorName: r.actorName, metadata: r.log.metadataJson })), hasMore: rows.length === limit });
});
