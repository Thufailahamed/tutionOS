import type { Database } from "@classflow/db";
import { auditLogs } from "@classflow/db";
import { uuid } from "./crypto";
import { nowIso } from "./http";

export async function audit(
  db: Database,
  entry: {
    orgId: string | null;
    actorUserId: string | null;
    action: string;
    entity?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await db.insert(auditLogs).values({
    id: uuid(),
    orgId: entry.orgId,
    actorUserId: entry.actorUserId,
    action: entry.action,
    entity: entry.entity ?? null,
    entityId: entry.entityId ?? null,
    metadataJson: JSON.stringify(entry.metadata ?? {}),
    createdAt: nowIso(),
  });
}
