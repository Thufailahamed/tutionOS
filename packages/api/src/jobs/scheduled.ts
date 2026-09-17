import { eq, and, sql, gte, lte, isNull, inArray } from "drizzle-orm";
import {
  createDb,
  organizations,
  classSessions,
  classes,
  classEnrollments,
  students,
  studentFees,
  sentReminders,
  guardians,
  studentGuardians,
  type Database,
} from "@classflow/db";
import { centsToDisplay } from "@classflow/core";
import type { Env } from "../env";
import { enqueueAll } from "../services/notify";
import { uuid } from "../lib/crypto";
import { nowIso, todayColombo } from "../lib/http";

type ChannelMsg = { kind: "channel"; orgId: string; channel: "sms"; recipient: string; body: string; idempotencyKey: string };

/**
 * Hourly cron. Handles:
 * 1. Class reminders — sessions starting within the next hour.
 * 2. Payment reminders — fees due within 3 days or overdue, deduped daily via sent_reminders.
 * 3. Rolling session materialization for all active orgs.
 */
export async function runScheduled(env: Env): Promise<void> {
  const db = createDb(env.DB);
  const today = todayColombo();
  const nowTs = Date.now();

  // ---- Class starting-soon reminders ----
  const nowMinutes = (new Date(nowTs).getUTCHours() * 60 + new Date(nowTs).getUTCMinutes() + 330) % 1440; // Colombo UTC+5:30
  const windowStart = `${String(Math.floor(nowMinutes / 60)).padStart(2, "0")}:${String(nowMinutes % 60).padStart(2, "0")}`;
  const endMinutes = (nowMinutes + 60) % 1440;
  const windowEnd = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;

  const sessionsToday = await db
    .select({ s: classSessions, className: classes.name, orgName: organizations.name })
    .from(classSessions)
    .innerJoin(classes, eq(classSessions.classId, classes.id))
    .innerJoin(organizations, eq(classes.orgId, organizations.id))
    .where(
      and(
        eq(classSessions.date, today),
        gte(classSessions.startTime, windowStart),
        lte(classSessions.startTime, windowEnd),
        eq(classSessions.status, "scheduled"),
      ),
    );

  const classMsgs: ChannelMsg[] = [];
  for (const row of sessionsToday) {
    const enrollments = await db
      .select({ studentId: classEnrollments.studentId })
      .from(classEnrollments)
      .where(and(eq(classEnrollments.classId, row.s.classId), eq(classEnrollments.status, "active")));
    for (const e of enrollments) {
      const refKey = `${row.s.id}:${e.studentId}`;
      if (await alreadySent(db, "class_reminder", refKey)) continue;
      await markSent(db, row.s.orgId, "class_reminder", refKey);
      const contacts = await guardianPhones(db, e.studentId);
      for (const phone of contacts) {
        classMsgs.push({
          kind: "channel",
          orgId: row.s.orgId,
          channel: "sms",
          recipient: phone,
          body: `${row.className} starts at ${row.s.startTime} today. — ${row.orgName}`,
          idempotencyKey: `class_reminder:${refKey}:${phone}`,
        });
      }
    }
  }
  await enqueueAll(env, "NOTIFICATIONS_QUEUE", classMsgs);

  // ---- Payment reminders (due soon / overdue) ----
  const in3d = new Date(nowTs + 3 * 86400e3).toISOString().slice(0, 10);
  const dueFees = await db
    .select({ f: studentFees, studentName: students.fullName, orgName: organizations.name })
    .from(studentFees)
    .innerJoin(students, eq(studentFees.studentId, students.id))
    .innerJoin(organizations, eq(studentFees.orgId, organizations.id))
    .where(and(inArray(studentFees.status, ["pending", "partial", "overdue"]), lte(studentFees.dueDate, in3d), isNull(students.deletedAt)));

  const payMsgs: ChannelMsg[] = [];
  for (const row of dueFees) {
    const kind = row.f.dueDate < today ? "payment_overdue" : "payment_due";
    const refKey = `${row.f.id}:${today}`;
    if (await alreadySent(db, kind, refKey)) continue;
    await markSent(db, row.f.orgId, kind, refKey);
    const balance = row.f.amountCents - row.f.discountCents - row.f.paidCents;
    const contacts = await guardianPhones(db, row.f.studentId);
    for (const phone of contacts) {
      payMsgs.push({
        kind: "channel",
        orgId: row.f.orgId,
        channel: "sms",
        recipient: phone,
        body: `Reminder: ${row.studentName} has an outstanding fee of ${centsToDisplay(balance)} due ${row.f.dueDate}. — ${row.orgName}`,
        idempotencyKey: `${kind}:${refKey}:${phone}`,
      });
    }
  }
  await enqueueAll(env, "NOTIFICATIONS_QUEUE", payMsgs);

  // ---- Mark newly-overdue fees ----
  await db
    .update(studentFees)
    .set({ status: "overdue", updatedAt: nowIso() })
    .where(and(inArray(studentFees.status, ["pending", "partial"]), lte(studentFees.dueDate, sql`date('now','-1 day')`)));

  // ---- Session materialization for all orgs (rolling 28-day window) ----
  const { materializeSessions } = await import("../routes/classes");
  const orgs = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.status, "active"));
  const to = new Date(nowTs + 28 * 86400e3).toISOString().slice(0, 10);
  for (const o of orgs) {
    await materializeSessions(db, o.id, today, to);
  }
}

async function alreadySent(db: Database, kind: string, refKey: string): Promise<boolean> {
  const rows = await db
    .select({ id: sentReminders.id })
    .from(sentReminders)
    .where(and(eq(sentReminders.kind, kind), eq(sentReminders.refKey, refKey)))
    .limit(1);
  return !!rows[0];
}

async function markSent(db: Database, orgId: string, kind: string, refKey: string): Promise<void> {
  await db.insert(sentReminders).values({ id: uuid(), orgId, kind, refKey, sentAt: nowIso() }).onConflictDoNothing();
}

async function guardianPhones(db: Database, studentId: string): Promise<string[]> {
  const rows = await db
    .select({ phone: guardians.phone })
    .from(studentGuardians)
    .innerJoin(guardians, eq(studentGuardians.guardianId, guardians.id))
    .where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.receivesNotifications, true)));
  return rows.map((r) => r.phone).filter(Boolean);
}
