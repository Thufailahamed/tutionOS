import { processBatch, type AnyMsg } from "@classflow/api/jobs/queue";
import { runScheduled } from "@classflow/api/jobs/scheduled";
import type { Env } from "@classflow/api";

export default {
  async queue(batch: MessageBatch<AnyMsg>, env: Env): Promise<void> {
    await processBatch(env, batch.queue, batch);
  },
  async scheduled(_ctrl: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env));
  },
};
