import { eq } from "drizzle-orm";
import { createDb, importJobs, organizations } from "@classflow/db";
import type { Env } from "../env";
import { dispatchChannel } from "../services/notify";
import { audit } from "../lib/audit";
import { nowIso } from "../lib/http";

/** Queue message shapes — must match what routes enqueue via enqueueAll(). */
export type ChannelMsg = {
  kind: "channel";
  orgId: string | null;
  channel: "sms" | "email" | "whatsapp";
  recipient: string;
  body: string;
  idempotencyKey?: string;
};

export type ImportMsg = { kind: "students_csv"; jobId: string };

export type AnyMsg = ChannelMsg | ImportMsg;

async function handleImport(env: Env, msg: ImportMsg): Promise<void> {
  const db = createDb(env.DB);
  const job = await db.select().from(importJobs).where(eq(importJobs.id, msg.jobId)).limit(1);
  if (!job[0] || job[0].status === "done") return;
  await db.update(importJobs).set({ status: "processing" }).where(eq(importJobs.id, job[0].id));
  try {
    const { importStudentRows } = await import("../routes/students");
    const payload = JSON.parse(job[0].payloadJson || "{}") as { rows?: Record<string, string>[] };
    const result = (await importStudentRows(db, job[0].orgId, payload.rows ?? [], job[0].createdBy)) as {
      imported: number;
      errors: { row: number; errors: string[] }[];
    };
    await db
      .update(importJobs)
      .set({
        status: "done",
        processed: result.imported + result.errors.length,
        errorsJson: JSON.stringify(result.errors),
        completedAt: nowIso(),
      })
      .where(eq(importJobs.id, job[0].id));
    await audit(db, {
      orgId: job[0].orgId,
      actorUserId: job[0].createdBy,
      action: "IMPORT_COMPLETED",
      entity: "import_job",
      entityId: job[0].id,
      metadata: { imported: result.imported, failed: result.errors.length },
    });
  } catch (e) {
    await db
      .update(importJobs)
      .set({ status: "failed", errorsJson: JSON.stringify([{ error: String(e) }]), completedAt: nowIso() })
      .where(eq(importJobs.id, job[0].id));
    throw e;
  }
}

export async function processBatch(env: Env, queue: string, batch: MessageBatch<AnyMsg>): Promise<void> {
  for (const m of batch.messages) {
    try {
      const body = m.body as AnyMsg;
      if (body.kind === "channel") {
        // dispatchChannel is idempotent (skips if idempotencyKey already logged)
        await dispatchChannel(createDb(env.DB), env, body);
      } else if (body.kind === "students_csv") {
        await handleImport(env, body);
      }
      m.ack();
    } catch (e) {
      console.error(`queue ${queue} message failed:`, e);
      m.retry();
    }
  }
}
