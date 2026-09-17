import { Hono } from "hono";
import { eq, and, isNull, sql, desc, asc, gte } from "drizzle-orm";
import { z } from "zod";
import {
  exams,
  examResults,
  classes,
  subjects,
  students,
  classEnrollments,
  type Database,
} from "@classflow/db";
import { examSchema, resultEntrySchema } from "@classflow/core";
import type { Env } from "../env";
import type { ApiVariables } from "../middleware/session";
import { requireAuth, requirePerm } from "../middleware/guard";
import { ok, notFound, badRequest, parsePagination, nowIso } from "../lib/http";
import { audit } from "../lib/audit";
import { uuid } from "../lib/crypto";
import { notifyStudentGuardians } from "../services/notify";

export const examRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

examRoutes.use("*", requireAuth);

/** Sri Lankan GCE-style grade bands, overridable per exam via gradingScheme JSON. */
export function gradeFor(percentageBps: number, scheme?: string | null): string {
  const def = [
    { min: 7500, grade: "A" },
    { min: 6500, grade: "B" },
    { min: 5000, grade: "C" },
    { min: 3500, grade: "S" },
    { min: 0, grade: "F" },
  ];
  let bands = def;
  if (scheme) {
    try {
      const parsed = JSON.parse(scheme) as { min: number; grade: string }[];
      if (Array.isArray(parsed) && parsed.length) {
        bands = parsed.map((b) => ({ min: b.min * 100, grade: b.grade })).sort((a, b) => b.min - a.min);
      }
    } catch {
      /* fall back to default */
    }
  }
  for (const b of bands) if (percentageBps >= b.min) return b.grade;
  return "F";
}

/** Competition ranking: equal marks share a rank, the next rank skips ahead. */
export function competitionRanks(marksDesc: (number | null)[]): number[] {
  const ranks: number[] = [];
  let rank = 0;
  let prev: number | null = null;
  let count = 0;
  for (const m of marksDesc) {
    count++;
    if (m !== prev) rank = count;
    prev = m;
    ranks.push(rank);
  }
  return ranks;
}

async function recomputeRanks(db: Database, orgId: string, examId: string) {
  const rows = await db
    .select()
    .from(examResults)
    .where(and(eq(examResults.examId, examId), eq(examResults.orgId, orgId)))
    .orderBy(desc(examResults.marks));
  const ranks = competitionRanks(rows.map((r) => r.marks));
  for (const [i, r] of rows.entries()) {
    if (r.rank !== ranks[i]) {
      await db.update(examResults).set({ rank: ranks[i] }).where(eq(examResults.id, r.id));
    }
  }
}

async function getExam(db: Database, orgId: string, id: string) {
  const rows = await db
    .select()
    .from(exams)
    .where(and(eq(exams.id, id), eq(exams.orgId, orgId), isNull(exams.deletedAt)))
    .limit(1);
  if (!rows[0]) notFound("Exam not found");
  return rows[0]!;
}

examRoutes.get("/", requirePerm("exams.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const { limit, offset } = parsePagination(c.req.url);
  const q = new URL(c.req.url).searchParams;
  const classId = q.get("classId");
  const conds = [eq(exams.orgId, member.orgId), isNull(exams.deletedAt)];
  if (classId) conds.push(eq(exams.classId, classId));
  const rows = await db
    .select({ exam: exams, className: classes.name, subjectName: subjects.name, resultCount: sql<number>`(select count(*) from exam_results er where er.exam_id = ${exams.id})` })
    .from(exams)
    .innerJoin(classes, eq(exams.classId, classes.id))
    .innerJoin(subjects, eq(classes.subjectId, subjects.id))
    .where(and(...conds))
    .orderBy(desc(exams.date))
    .limit(limit)
    .offset(offset);
  return ok(rows.map((r) => ({ ...r.exam, className: r.className, subjectName: r.subjectName, resultCount: r.resultCount })));
});

examRoutes.post("/", requirePerm("exams.create"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = examSchema.parse(await c.req.json());
  const cls = await db.select().from(classes).where(and(eq(classes.id, body.classId), eq(classes.orgId, member.orgId))).limit(1);
  if (!cls[0]) return badRequest("Class not found");
  const id = uuid();
  const now = nowIso();
  await db.insert(exams).values({
    id,
    orgId: member.orgId,
    classId: body.classId,
    title: body.title.trim(),
    type: body.type,
    date: body.date,
    durationMinutes: body.durationMinutes ?? null,
    maxMarks: body.maxMarks,
    gradingScheme: body.gradingScheme ?? null,
    status: "draft",
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  });
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "EXAM_CREATED", entity: "exam", entityId: id });
  return ok({ id }, { status: 201 });
});

examRoutes.get("/:id", requirePerm("exams.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const exam = await getExam(db, member.orgId, c.req.param("id"));
  const cls = await db
    .select({ name: classes.name, subjectName: subjects.name })
    .from(classes)
    .innerJoin(subjects, eq(classes.subjectId, subjects.id))
    .where(eq(classes.id, exam.classId))
    .limit(1);
  const roster = await db
    .select({ studentId: students.id, fullName: students.fullName, studentNo: students.studentNo })
    .from(classEnrollments)
    .innerJoin(students, eq(classEnrollments.studentId, students.id))
    .where(and(eq(classEnrollments.classId, exam.classId), eq(classEnrollments.status, "active")))
    .orderBy(students.fullName);
  const results = await db.select().from(examResults).where(eq(examResults.examId, exam.id)).orderBy(asc(examResults.rank));
  const stats = computeStats(results, exam.maxMarks);
  return ok({
    ...exam,
    className: cls[0]?.name ?? "",
    subjectName: cls[0]?.subjectName ?? "",
    roster: roster.map((s) => ({ ...s, result: results.find((r) => r.studentId === s.studentId) ?? null })),
    stats,
  });
});

function computeStats(results: { marks: number | null }[], maxMarks: number) {
  const marks = results.map((r) => r.marks).filter((m): m is number => m != null);
  if (!marks.length) return { count: 0, average: null, highest: null, lowest: null, passRate: null };
  const avg = marks.reduce((a, b) => a + b, 0) / marks.length;
  const passCount = marks.filter((m) => m >= maxMarks * 0.35).length;
  return {
    count: marks.length,
    average: Math.round(avg * 100) / 100,
    highest: Math.max(...marks),
    lowest: Math.min(...marks),
    passRate: Math.round((passCount / marks.length) * 1000) / 10,
  };
}

examRoutes.patch("/:id", requirePerm("exams.edit"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const exam = await getExam(db, member.orgId, c.req.param("id"));
  const body = examSchema.partial().parse(await c.req.json());
  await db.update(exams).set({ ...(body as Record<string, unknown>), updatedAt: nowIso() }).where(eq(exams.id, exam.id));
  if (body.maxMarks && body.maxMarks !== exam.maxMarks) {
    await recalcPercentages(db, member.orgId, exam.id, body.maxMarks, body.gradingScheme ?? exam.gradingScheme);
  }
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "EXAM_UPDATED", entity: "exam", entityId: exam.id });
  return ok({ updated: true });
});

examRoutes.delete("/:id", requirePerm("exams.edit"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const exam = await getExam(db, member.orgId, c.req.param("id"));
  await db.update(exams).set({ deletedAt: nowIso() }).where(eq(exams.id, exam.id));
  return ok({ deleted: true });
});

async function recalcPercentages(db: Database, orgId: string, examId: string, maxMarks: number, scheme?: string | null) {
  const rows = await db.select().from(examResults).where(and(eq(examResults.examId, examId), eq(examResults.orgId, orgId)));
  for (const r of rows) {
    if (r.marks == null) continue;
    const bps = Math.round((r.marks / maxMarks) * 10000);
    await db.update(examResults).set({ percentage: bps, grade: gradeFor(bps, scheme) }).where(eq(examResults.id, r.id));
  }
}

/** Spreadsheet-style bulk result entry. */
examRoutes.post("/:id/results", requirePerm("results.enter"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const exam = await getExam(db, member.orgId, c.req.param("id"));
  const body = resultEntrySchema.parse(await c.req.json());
  const enrolled = await db
    .select({ studentId: classEnrollments.studentId })
    .from(classEnrollments)
    .where(and(eq(classEnrollments.classId, exam.classId), eq(classEnrollments.status, "active")));
  const enrolledIds = new Set(enrolled.map((e) => e.studentId));
  const now = nowIso();
  let entered = 0;
  for (const r of body.results) {
    if (!enrolledIds.has(r.studentId)) continue;
    const marks = r.marks == null ? null : Math.min(r.marks, exam.maxMarks);
    const bps = marks == null ? null : Math.round((marks / exam.maxMarks) * 10000);
    const grade = bps == null ? null : gradeFor(bps, exam.gradingScheme);
    const existing = await db
      .select({ id: examResults.id })
      .from(examResults)
      .where(and(eq(examResults.examId, exam.id), eq(examResults.studentId, r.studentId)))
      .limit(1);
    if (existing[0]) {
      await db.update(examResults).set({ marks, percentage: bps, grade, remarks: r.remarks ?? null, enteredBy: user.id, enteredAt: now }).where(eq(examResults.id, existing[0].id));
    } else {
      await db.insert(examResults).values({
        id: uuid(),
        orgId: member.orgId,
        examId: exam.id,
        studentId: r.studentId,
        marks,
        percentage: bps,
        grade,
        remarks: r.remarks ?? null,
        enteredBy: user.id,
        enteredAt: now,
      });
    }
    entered++;
  }
  await recomputeRanks(db, member.orgId, exam.id);
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "RESULT_ENTERED", entity: "exam", entityId: exam.id, metadata: { entered } });
  return ok({ entered });
});

examRoutes.post("/:id/publish", requirePerm("results.publish"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const exam = await getExam(db, member.orgId, c.req.param("id"));
  const now = nowIso();
  await db.update(exams).set({ status: "published", updatedAt: now }).where(eq(exams.id, exam.id));
  await db.update(examResults).set({ publishedAt: now }).where(and(eq(examResults.examId, exam.id), isNull(examResults.publishedAt)));
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "RESULT_PUBLISHED", entity: "exam", entityId: exam.id });
  const results = await db.select().from(examResults).where(eq(examResults.examId, exam.id));
  const cls = await db.select().from(classes).where(eq(classes.id, exam.classId)).limit(1);
  await notifyStudentGuardians(db, c.env, {
    orgId: member.orgId,
    studentIds: results.map((r) => r.studentId),
    type: "results_published",
    title: `Results published: ${exam.title}`,
    body: `Results for ${cls[0]?.name ?? "exam"} are now available.`,
    actionUrl: "/parent",
  });
  return ok({ published: true });
});

examRoutes.get("/:id/rankings", requirePerm("exams.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const exam = await getExam(db, member.orgId, c.req.param("id"));
  const rows = await db
    .select({ result: examResults, studentName: students.fullName, studentNo: students.studentNo })
    .from(examResults)
    .innerJoin(students, eq(examResults.studentId, students.id))
    .where(eq(examResults.examId, exam.id))
    .orderBy(asc(examResults.rank));
  return ok(rows.map((r) => ({ ...r.result, studentName: r.studentName, studentNo: r.studentNo })));
});

/** Progress series for one student across exams in a class. */
examRoutes.get("/progress/:classId/:studentId", requirePerm("exams.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const rows = await db
    .select({ exam: exams, result: examResults })
    .from(examResults)
    .innerJoin(exams, eq(examResults.examId, exams.id))
    .where(
      and(
        eq(examResults.orgId, member.orgId),
        eq(examResults.studentId, c.req.param("studentId")),
        eq(exams.classId, c.req.param("classId")),
      ),
    )
    .orderBy(asc(exams.date));
  return ok(rows.map((r) => ({ title: r.exam.title, date: r.exam.date, type: r.exam.type, marks: r.result.marks, percentage: r.result.percentage, grade: r.result.grade, rank: r.result.rank, maxMarks: r.exam.maxMarks })));
});

/** Report card: all published results for a student, grouped by exam. */
examRoutes.get("/report-card/:studentId", requirePerm("exams.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const studentId = c.req.param("studentId");
  const st = await db.select().from(students).where(and(eq(students.id, studentId), eq(students.orgId, member.orgId))).limit(1);
  if (!st[0]) return notFound("Student not found");
  const rows = await db
    .select({ exam: exams, result: examResults, className: classes.name, subjectName: subjects.name })
    .from(examResults)
    .innerJoin(exams, eq(examResults.examId, exams.id))
    .innerJoin(classes, eq(exams.classId, classes.id))
    .innerJoin(subjects, eq(classes.subjectId, subjects.id))
    .where(and(eq(examResults.orgId, member.orgId), eq(examResults.studentId, studentId), eq(exams.status, "published")))
    .orderBy(desc(exams.date));
  const avg = rows.length ? Math.round(rows.reduce((a, r) => a + (r.result.percentage ?? 0), 0) / rows.length) / 100 : null;
  return ok({
    student: { id: st[0].id, name: st[0].fullName, studentNo: st[0].studentNo },
    entries: rows.map((r) => ({
      examId: r.exam.id,
      title: r.exam.title,
      type: r.exam.type,
      date: r.exam.date,
      className: r.className,
      subjectName: r.subjectName,
      marks: r.result.marks,
      maxMarks: r.exam.maxMarks,
      percentage: r.result.percentage,
      grade: r.result.grade,
      rank: r.result.rank,
      remarks: r.result.remarks,
    })),
    averagePercentage: avg,
  });
});
