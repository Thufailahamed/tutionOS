import { Hono } from "hono";
import { eq, and, isNull, desc, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  announcements,
  messageThreads,
  messageParticipants,
  messages,
  notifications,
  users,
  students,
  guardians,
  studentGuardians,
  classEnrollments,
  organizationMembers,
} from "@classflow/db";
import { announcementSchema, messageSchema } from "@classflow/core";
import type { Env } from "../env";
import type { ApiVariables } from "../middleware/session";
import { requireAuth, requirePerm } from "../middleware/guard";
import { ok, notFound, forbidden, parsePagination, nowIso } from "../lib/http";
import { audit } from "../lib/audit";
import { uuid } from "../lib/crypto";
import { inAppNotify, notifyStudentGuardians, orgUserIds, enqueueAll } from "../services/notify";

export const commsRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

commsRoutes.use("*", requireAuth);

// ---------- Announcements ----------

commsRoutes.get("/announcements", async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const { limit, offset } = parsePagination(c.req.url);
  const rows = await db
    .select({ a: announcements, authorName: users.fullName })
    .from(announcements)
    .innerJoin(users, eq(announcements.createdBy, users.id))
    .where(and(eq(announcements.orgId, member.orgId), isNull(announcements.deletedAt)))
    .orderBy(desc(announcements.createdAt))
    .limit(limit)
    .offset(offset);
  return ok(rows.map((r) => ({ ...r.a, authorName: r.authorName, studentIds: JSON.parse(r.a.studentIdsJson || "[]") })));
});

commsRoutes.post("/announcements", requirePerm("announcements.manage"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = announcementSchema.parse(await c.req.json());
  const id = uuid();
  const now = nowIso();
  await db.insert(announcements).values({
    id,
    orgId: member.orgId,
    title: body.title.trim(),
    body: body.body,
    audience: body.audience,
    classId: body.classId ?? null,
    studentIdsJson: JSON.stringify(body.studentIds ?? []),
    createdBy: user.id,
    createdAt: now,
  });
  // fan out in-app notifications to the audience
  const rows: Parameters<typeof inAppNotify>[1] = [];
  if (body.audience === "all") {
    const memberIds = await orgUserIds(db, member.orgId);
    for (const uid of memberIds) {
      if (uid !== user.id) rows.push({ orgId: member.orgId, userId: uid, type: "announcement", title: body.title, body: body.body, actionUrl: "/app/announcements" });
    }
    // also notify all linked guardians + student users
    const studentIds = body.classId
      ? (await db.select({ studentId: classEnrollments.studentId }).from(classEnrollments).where(and(eq(classEnrollments.classId, body.classId), eq(classEnrollments.status, "active")))).map((r) => r.studentId)
      : (await db.select({ id: students.id }).from(students).where(eq(students.orgId, member.orgId))).map((r) => r.id);
    await notifyStudentGuardians(db, c.env, { orgId: member.orgId, studentIds, type: "announcement", title: body.title, body: body.body, actionUrl: "/parent" });
  } else if (body.audience === "class" || body.audience === "students" || body.audience === "parents") {
    let studentIds = body.studentIds ?? [];
    if (body.classId) {
      const enrolled = await db
        .select({ studentId: classEnrollments.studentId })
        .from(classEnrollments)
        .where(and(eq(classEnrollments.classId, body.classId), eq(classEnrollments.status, "active")));
      studentIds = [...new Set([...studentIds, ...enrolled.map((e) => e.studentId)])];
    }
    await notifyStudentGuardians(db, c.env, { orgId: member.orgId, studentIds, type: "announcement", title: body.title, body: body.body, actionUrl: "/parent" });
    if (body.audience !== "parents") {
      const studentUsers = await db.select({ userId: students.userId }).from(students).where(inArray(students.id, studentIds.length ? studentIds : ["-"]));
      for (const su of studentUsers) {
        if (su.userId) rows.push({ orgId: member.orgId, userId: su.userId, type: "announcement", title: body.title, body: body.body, actionUrl: "/portal" });
      }
    }
  }
  await inAppNotify(db, rows);
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "ANNOUNCEMENT_CREATED", entity: "announcement", entityId: id });
  return ok({ id }, { status: 201 });
});

commsRoutes.delete("/announcements/:id", requirePerm("announcements.manage"), async (c) => {
  const member = c.get("member")!;
  await c.get("db").update(announcements).set({ deletedAt: nowIso() }).where(and(eq(announcements.id, c.req.param("id")), eq(announcements.orgId, member.orgId)));
  return ok({ deleted: true });
});

// ---------- Notifications ----------

commsRoutes.get("/notifications", async (c) => {
  const user = c.get("user")!;
  const { limit, offset } = parsePagination(c.req.url, 30);
  const rows = await c.get("db")
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);
  const unread = await c.get("db")
    .select({ n: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), eq(notifications.status, "unread")));
  return ok({ notifications: rows, unread: unread[0]?.n ?? 0 });
});

commsRoutes.post("/notifications/read", async (c) => {
  const user = c.get("user")!;
  const body = z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() }).parse(await c.req.json());
  const db = c.get("db");
  if (body.all) {
    await db.update(notifications).set({ status: "read", readAt: nowIso() }).where(and(eq(notifications.userId, user.id), eq(notifications.status, "unread")));
  } else if (body.ids?.length) {
    await db.update(notifications).set({ status: "read", readAt: nowIso() }).where(and(eq(notifications.userId, user.id), inArray(notifications.id, body.ids)));
  }
  return ok({ read: true });
});

commsRoutes.get("/notifications/log", requirePerm("notifications.manage"), async (c) => {
  const member = c.get("member")!;
  const { notificationLog } = await import("@classflow/db");
  const rows = await c.get("db").select().from(notificationLog).where(eq(notificationLog.orgId, member.orgId)).orderBy(desc(notificationLog.createdAt)).limit(100);
  return ok(rows);
});

// ---------- Direct messages ----------

commsRoutes.get("/threads", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const participantThreads = await db
    .select({ threadId: messageParticipants.threadId })
    .from(messageParticipants)
    .where(eq(messageParticipants.userId, user.id));
  const ids = participantThreads.map((p) => p.threadId);
  if (!ids.length) return ok([]);
  const rows = await db
    .select({ thread: messageThreads, studentName: students.fullName })
    .from(messageThreads)
    .leftJoin(students, eq(messageThreads.studentId, students.id))
    .where(inArray(messageThreads.id, ids))
    .orderBy(desc(messageThreads.lastMessageAt));
  const participants = await db
    .select({ p: messageParticipants, name: users.fullName })
    .from(messageParticipants)
    .innerJoin(users, eq(messageParticipants.userId, users.id))
    .where(inArray(messageParticipants.threadId, ids));
  return ok(rows.map((r) => ({ ...r.thread, studentName: r.studentName, participants: participants.filter((p) => p.p.threadId === r.thread.id).map((p) => ({ userId: p.p.userId, name: p.name })) })));
});

commsRoutes.post("/threads", async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = z
    .object({
      participantUserIds: z.array(z.string()).min(1),
      subject: z.string().max(200).optional(),
      studentId: z.string().optional(),
      body: z.string().min(1).max(4000),
    })
    .parse(await c.req.json());
  const id = uuid();
  const now = nowIso();
  await db.insert(messageThreads).values({
    id,
    orgId: member.orgId,
    kind: "direct",
    subject: body.subject ?? null,
    studentId: body.studentId ?? null,
    createdBy: user.id,
    createdAt: now,
    lastMessageAt: now,
  });
  const allParticipants = [...new Set([user.id, ...body.participantUserIds])];
  await db.insert(messageParticipants).values(
    allParticipants.map((uid) => ({ id: uuid(), threadId: id, userId: uid, createdAt: now })),
  );
  const mid = uuid();
  await db.insert(messages).values({ id: mid, orgId: member.orgId, threadId: id, senderUserId: user.id, body: body.body, createdAt: now });
  await inAppNotify(
    db,
    body.participantUserIds.map((uid) => ({
      orgId: member.orgId,
      userId: uid,
      type: "message",
      title: `New message from ${user.fullName}`,
      body: body.body.slice(0, 140),
      actionUrl: "/app/messages",
    })),
  );
  return ok({ threadId: id, messageId: mid }, { status: 201 });
});

commsRoutes.get("/threads/:id/messages", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const threadId = c.req.param("id");
  const participant = await db
    .select()
    .from(messageParticipants)
    .where(and(eq(messageParticipants.threadId, threadId), eq(messageParticipants.userId, user.id)))
    .limit(1);
  if (!participant[0]) return forbidden("Not a thread participant");
  const rows = await db
    .select({ msg: messages, senderName: users.fullName })
    .from(messages)
    .innerJoin(users, eq(messages.senderUserId, users.id))
    .where(eq(messages.threadId, threadId))
    .orderBy(messages.createdAt);
  return ok(rows.map((r) => ({ ...r.msg, senderName: r.senderName })));
});

commsRoutes.post("/threads/:id/messages", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const threadId = c.req.param("id");
  const participant = await db
    .select()
    .from(messageParticipants)
    .where(and(eq(messageParticipants.threadId, threadId), eq(messageParticipants.userId, user.id)))
    .limit(1);
  if (!participant[0]) return forbidden("Not a thread participant");
  const thread = await db.select().from(messageThreads).where(eq(messageThreads.id, threadId)).limit(1);
  if (!thread[0]) return notFound();
  const body = messageSchema.parse(await c.req.json());
  const now = nowIso();
  const mid = uuid();
  await db.insert(messages).values({ id: mid, orgId: thread[0].orgId, threadId, senderUserId: user.id, body: body.body, createdAt: now });
  await db.update(messageThreads).set({ lastMessageAt: now }).where(eq(messageThreads.id, threadId));
  const others = await db.select().from(messageParticipants).where(eq(messageParticipants.threadId, threadId));
  await inAppNotify(
    db,
    others
      .filter((p) => p.userId !== user.id)
      .map((p) => ({
        orgId: thread[0].orgId,
        userId: p.userId,
        type: "message",
        title: `New message from ${user.fullName}`,
        body: body.body.slice(0, 140),
        actionUrl: "/app/messages",
      })),
  );
  return ok({ messageId: mid }, { status: 201 });
});

/** Contactable people for starting a thread: org members + guardians + student users */
commsRoutes.get("/contacts", async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const members = await db
    .select({ userId: organizationMembers.userId, name: users.fullName, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(and(eq(organizationMembers.orgId, member.orgId), eq(organizationMembers.status, "active")));
  const guardianUsers = await db
    .select({ userId: guardians.userId, name: guardians.fullName, guardianId: guardians.id })
    .from(guardians)
    .where(eq(guardians.orgId, member.orgId));
  return ok({
    members: members.map((m) => ({ ...m, kind: "staff" })),
    guardians: guardianUsers.filter((g) => g.userId).map((g) => ({ userId: g.userId, name: g.name, kind: "guardian", guardianId: g.guardianId })),
  });
});
