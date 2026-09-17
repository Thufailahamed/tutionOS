import { eq, and, inArray } from "drizzle-orm";
import {
  notifications,
  notificationLog,
  notificationPreferences,
  studentGuardians,
  guardians,
  users,
  type Database,
} from "@classflow/db";
import { uuid } from "../lib/crypto";
import { nowIso } from "../lib/http";
import type { Env } from "../env";

/**
 * Notification dispatch — provider-abstracted.
 * Channels: in_app (DB row), sms / email / whatsapp (provider plugins).
 * The default "log" provider records into notification_log (visible in dev).
 */

interface SendResult {
  status: "sent" | "failed";
  provider: string;
  error?: string;
}

interface ChannelProvider {
  name: string;
  send(recipient: string, body: string, env: Env): Promise<SendResult>;
}

const logProvider = (name: string): ChannelProvider => ({
  name,
  async send(recipient, body) {
    console.log(`[${name}] → ${recipient}: ${body.slice(0, 140)}`);
    return { status: "sent", provider: name };
  },
});

const httpProvider = (
  name: string,
  urlKey: keyof Env,
  keyKey: keyof Env,
): ChannelProvider => ({
  name,
  async send(recipient, body, env) {
    const url = env[urlKey] as string | undefined;
    const key = env[keyKey] as string | undefined;
    if (!url || !key) return { status: "failed", provider: name, error: "provider not configured" };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ to: recipient, message: body }),
      });
      return res.ok
        ? { status: "sent", provider: name }
        : { status: "failed", provider: name, error: `HTTP ${res.status}` };
    } catch (e) {
      return { status: "failed", provider: name, error: String(e) };
    }
  },
});

function providerFor(channel: "sms" | "email" | "whatsapp", env: Env): ChannelProvider {
  const configured =
    channel === "sms" ? env.SMS_PROVIDER : channel === "email" ? env.EMAIL_PROVIDER : env.WHATSAPP_PROVIDER;
  if (configured === "http") {
    return httpProvider(
      `${channel}_http`,
      channel === "sms" ? "SMS_API_URL" : channel === "email" ? "EMAIL_API_URL" : "WHATSAPP_API_URL",
      channel === "sms" ? "SMS_API_KEY" : channel === "email" ? "EMAIL_API_KEY" : "WHATSAPP_API_KEY",
    );
  }
  return logProvider(`${channel}_log`);
}

export async function dispatchChannel(
  db: Database,
  env: Env,
  msg: {
    orgId: string | null;
    channel: "sms" | "email" | "whatsapp";
    recipient: string;
    body: string;
    idempotencyKey?: string;
  },
) {
  if (msg.idempotencyKey) {
    const dupe = await db
      .select({ id: notificationLog.id })
      .from(notificationLog)
      .where(eq(notificationLog.idempotencyKey, msg.idempotencyKey))
      .limit(1);
    if (dupe[0]) return { skipped: true };
  }
  const provider = providerFor(msg.channel, env);
  const result = await provider.send(msg.recipient, msg.body, env);
  await db.insert(notificationLog).values({
    id: uuid(),
    orgId: msg.orgId,
    channel: msg.channel,
    provider: result.provider,
    recipient: msg.recipient,
    body: msg.body,
    status: result.status,
    error: result.error ?? null,
    idempotencyKey: msg.idempotencyKey ?? null,
    createdAt: nowIso(),
  });
  return result;
}

export async function inAppNotify(
  db: Database,
  rows: {
    orgId: string | null;
    userId: string;
    type: string;
    title: string;
    body?: string;
    actionUrl?: string;
  }[],
) {
  if (rows.length === 0) return;
  const now = nowIso();
  await db.insert(notifications).values(
    rows.map((r) => ({
      id: uuid(),
      orgId: r.orgId,
      userId: r.userId,
      type: r.type,
      title: r.title,
      body: r.body ?? null,
      actionUrl: r.actionUrl ?? null,
      status: "unread",
      createdAt: now,
    })),
  );
}

async function prefEnabled(db: Database, userId: string, type: string, channel: string) {
  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.type, type),
        eq(notificationPreferences.channel, channel),
      ),
    )
    .limit(1);
  return rows[0] ? rows[0].enabled : true;
}

/**
 * Notify guardians linked to a student — in-app + queue channel messages.
 * Channel dispatch goes through the notifications queue when available.
 */
export async function notifyStudentGuardians(
  db: Database,
  env: Env,
  opts: {
    orgId: string;
    studentIds: string[];
    type: string;
    title: string;
    body: string;
    actionUrl?: string;
  },
) {
  const links = await db
    .select({
      guardianId: studentGuardians.guardianId,
      guardianUserId: guardians.userId,
      guardianPhone: guardians.phone,
      guardianEmail: guardians.email,
      receives: studentGuardians.receivesNotifications,
    })
    .from(studentGuardians)
    .innerJoin(guardians, eq(studentGuardians.guardianId, guardians.id))
    .where(
      and(
        eq(studentGuardians.orgId, opts.orgId),
        inArray(studentGuardians.studentId, opts.studentIds),
        eq(studentGuardians.receivesNotifications, true),
      ),
    );

  const inAppRows: Parameters<typeof inAppNotify>[1] = [];
  const queueMsgs: object[] = [];
  for (const l of links) {
    if (l.guardianUserId) {
      if (await prefEnabled(db, l.guardianUserId, opts.type, "in_app")) {
        inAppRows.push({
          orgId: opts.orgId,
          userId: l.guardianUserId,
          type: opts.type,
          title: opts.title,
          body: opts.body,
          actionUrl: opts.actionUrl,
        });
      }
      if (await prefEnabled(db, l.guardianUserId, opts.type, "sms")) {
        queueMsgs.push({
          kind: "channel",
          orgId: opts.orgId,
          channel: "sms",
          recipient: l.guardianPhone,
          body: `${opts.title}: ${opts.body}`,
          idempotencyKey: `${opts.type}:${l.guardianUserId}:${opts.title}`,
        });
      }
    }
  }
  await inAppNotify(db, inAppRows);
  await enqueueAll(env, "NOTIFICATIONS_QUEUE", queueMsgs);
}

export async function enqueueAll(env: Env, queueKey: "NOTIFICATIONS_QUEUE" | "JOBS_QUEUE", msgs: object[]) {
  const q = env[queueKey];
  if (!q || msgs.length === 0) return;
  for (let i = 0; i < msgs.length; i += 90) {
    const batch = msgs.slice(i, i + 90);
    await q.sendBatch(batch.map((m) => ({ body: m })));
  }
}

export async function orgUserIds(db: Database, orgId: string): Promise<string[]> {
  const { organizationMembers } = await import("@classflow/db");
  const rows = await db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.status, "active")));
  return rows.map((r) => r.userId);
}

export { users };
