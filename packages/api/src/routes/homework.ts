import { Hono } from "hono";
import { eq, and, isNull, sql, desc } from "drizzle-orm";
import { z } from "zod";
import {
  homework,
  homeworkSubmissions,
  classes,
  subjects,
  students,
  classEnrollments,
} from "@classflow/db";
import { homeworkSchema } from "@classflow/core";
import type { Env } from "../env";
import type { ApiVariables } from "../middleware/session";
import { requireAuth, requirePerm } from "../middleware/guard";
import { ok, notFound, badRequest, parsePagination, nowIso } from "../lib/http";
import { audit } from "../lib/audit";
import { uuid } from "../lib/crypto";
import { inAppNotify } from "../services/notify";

export const homeworkRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

homeworkRoutes.use("*", requireAuth);

homeworkRoutes.get("/", requirePerm("homework.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const { limit, offset } = parsePagination(c.req.url);
  const classId = new URL(c.req.url).searchParams.get("classId");
  const conds = [eq(homework.orgId, member.orgId), isNull(homework.deletedAt)];
  if (classId) conds.push(eq(homework.classId, classId));
  const rows = await db
    .select({
      hw: homework,
      className: classes.name,
      subjectName: subjects.name,
      submissions: sql<number>`(select count(*) from homework_submissions hs where hs.homework_id = ${homework.id} and hs.status in ('submitted','late','graded'))`,
      pending: sql<number>`(select count(*) from homework_submissions hs where hs.homework_id = ${homework.id} and hs.status in ('submitted','late'))`,
      total: sql<number>`(select count(*) from homework_submissions hs where hs.homework_id = ${homework.id})`,
    })
    .from(homework)
    .innerJoin(classes, eq(homework.classId, classes.id))
    .innerJoin(subjects, eq(classes.subjectId, subjects.id))
    .where(and(...conds))
    .orderBy(desc(homework.createdAt))
    .limit(limit)
    .offset(offset);
  return ok(rows.map((r) => ({ ...r.hw, attachments: JSON.parse(r.hw.attachmentsJson || "[]"), className: r.className, subjectName: r.subjectName, counts: { submissions: r.submissions, pending: r.pending, total: r.total } })));
});

homeworkRoutes.post("/", requirePerm("homework.manage"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = homeworkSchema.parse(await c.req.json());
  const cls = await db.select().from(classes).where(and(eq(classes.id, body.classId), eq(classes.orgId, member.orgId))).limit(1);
  if (!cls[0]) return badRequest("Class not found");
  const id = uuid();
  const now = nowIso();
  await db.insert(homework).values({
    id,
    orgId: member.orgId,
    classId: body.classId,
    title: body.title.trim(),
    description: body.description ?? null,
    dueAt: body.dueAt,
    maxMarks: body.maxMarks ?? null,
    attachmentsJson: JSON.stringify(body.attachmentKeys ?? []),
    createdBy: user.id,
    createdAt: now,
  });
  // pre-create "assigned" submission rows for each enrolled student
  const enrolled = await db
    .select({ studentId: classEnrollments.studentId })
    .from(classEnrollments)
    .where(and(eq(classEnrollments.classId, body.classId), eq(classEnrollments.status, "active")));
  if (enrolled.length) {
    await db.insert(homeworkSubmissions).values(
      enrolled.map((e) => ({
        id: uuid(),
        orgId: member.orgId,
        homeworkId: id,
        studentId: e.studentId,
        status: "assigned",
      })),
    );
  }
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "HOMEWORK_CREATED", entity: "homework", entityId: id });
  return ok({ id, assigned: enrolled.length }, { status: 201 });
});

homeworkRoutes.get("/:id", requirePerm("homework.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const rows = await db
    .select({ hw: homework, className: classes.name })
    .from(homework)
    .innerJoin(classes, eq(homework.classId, classes.id))
    .where(and(eq(homework.id, c.req.param("id")), eq(homework.orgId, member.orgId), isNull(homework.deletedAt)))
    .limit(1);
  if (!rows[0]) return notFound();
  const subs = await db
    .select({ sub: homeworkSubmissions, studentName: students.fullName, studentNo: students.studentNo })
    .from(homeworkSubmissions)
    .innerJoin(students, eq(homeworkSubmissions.studentId, students.id))
    .where(eq(homeworkSubmissions.homeworkId, rows[0].hw.id))
    .orderBy(students.fullName);
  return ok({
    ...rows[0].hw,
    className: rows[0].className,
    attachments: JSON.parse(rows[0].hw.attachmentsJson || "[]"),
    submissions: subs.map((s) => ({ ...s.sub, files: JSON.parse(s.sub.filesJson || "[]"), studentName: s.studentName, studentNo: s.studentNo })),
  });
});

homeworkRoutes.patch("/:id", requirePerm("homework.manage"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const body = homeworkSchema.partial().parse(await c.req.json());
  const rows = await db.select().from(homework).where(and(eq(homework.id, c.req.param("id")), eq(homework.orgId, member.orgId))).limit(1);
  if (!rows[0]) return notFound();
  await db.update(homework).set(body as Record<string, unknown>).where(eq(homework.id, rows[0].id));
  return ok({ updated: true });
});

homeworkRoutes.post("/:id/submissions/:studentId/grade", requirePerm("homework.grade"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = z.object({ marks: z.number().min(0).optional(), feedback: z.string().max(2000).optional() }).parse(await c.req.json());
  const rows = await db
    .select()
    .from(homeworkSubmissions)
    .where(and(eq(homeworkSubmissions.homeworkId, c.req.param("id")), eq(homeworkSubmissions.studentId, c.req.param("studentId")), eq(homeworkSubmissions.orgId, member.orgId)))
    .limit(1);
  if (!rows[0]) return notFound("Submission not found");
  await db.update(homeworkSubmissions).set({
    marks: body.marks ?? null,
    feedback: body.feedback ?? null,
    status: "graded",
    gradedBy: user.id,
    gradedAt: nowIso(),
  }).where(eq(homeworkSubmissions.id, rows[0].id));
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "HOMEWORK_GRADED", entity: "homework_submission", entityId: rows[0].id });
  // notify the student if they have an account
  const st = await db.select({ userId: students.userId, name: students.fullName }).from(students).where(eq(students.id, c.req.param("studentId"))).limit(1);
  if (st[0]?.userId) {
    await inAppNotify(db, [{ orgId: member.orgId, userId: st[0].userId, type: "homework_graded", title: "Homework graded", body: "Your homework submission was graded.", actionUrl: "/portal/homework" }]);
  }
  return ok({ graded: true });
});
