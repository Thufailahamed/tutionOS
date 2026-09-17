import { Hono } from "hono";
import { eq, and, or, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  files,
  learningMaterials,
  materialAccess,
  recordedLessons,
  students,
  guardians,
  studentGuardians,
  classEnrollments,
  homework,
  type Database,
} from "@classflow/db";
import type { Env } from "../env";
import type { ApiVariables } from "../middleware/session";
import { requireAuth, requirePerm } from "../middleware/guard";
import { ok, notFound, forbidden, badRequest, nowIso } from "../lib/http";
import { audit } from "../lib/audit";
import { uuid } from "../lib/crypto";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

export const fileRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

fileRoutes.use("*", requireAuth);

/** Upload (multipart/form-data, field "file", optional "kind"). */
fileRoutes.post("/", async (c) => {
  const member = c.get("member");
  const user = c.get("user")!;
  const db = c.get("db");
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("file field required");
  if (file.size > MAX_FILE_BYTES) return badRequest("File exceeds 25MB limit");
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_MIME.has(mime)) return badRequest(`File type not allowed: ${mime}`);
  const kind = (form.get("kind") as string) || "generic";
  const orgId = member?.orgId;
  if (!orgId) return forbidden("Organization context required for upload");
  const key = `org/${orgId}/${kind}/${uuid()}-${file.name.replace(/[^\w.\-]/g, "_").slice(0, 80)}`;
  await c.env.FILES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: mime },
    customMetadata: { originalName: file.name, uploadedBy: user.id },
  });
  const id = uuid();
  await db.insert(files).values({
    id,
    orgId,
    key,
    name: file.name,
    sizeBytes: file.size,
    mime,
    kind,
    ownerUserId: user.id,
    createdAt: nowIso(),
  });
  await audit(db, { orgId, actorUserId: user.id, action: "FILE_UPLOADED", entity: "file", entityId: id, metadata: { kind, size: file.size } });
  return ok({ id, key, name: file.name, size: file.size, mime }, { status: 201 });
});

/**
 * Authorized download.
 * Access: org member | student user with access via material/lesson/enrollment |
 * guardian of a student with access.
 */
async function canAccessFile(db: Database, userId: string, orgId: string, key: string, isMember: boolean): Promise<boolean> {
  if (isMember) return true;
  // which entities reference this key?
  const materials = await db.select().from(learningMaterials).where(and(eq(learningMaterials.fileKey, key), eq(learningMaterials.orgId, orgId)));
  const lessons = await db.select().from(recordedLessons).where(and(eq(recordedLessons.fileKey, key), eq(recordedLessons.orgId, orgId)));
  const hws = await db.select().from(homework).where(eq(homework.orgId, orgId));
  const hwMatch = hws.filter((h) => (JSON.parse(h.attachmentsJson || "[]") as string[]).includes(key));
  // gather student's ids for this user
  const studentRows = await db.select({ id: students.id }).from(students).where(and(eq(students.userId, userId), eq(students.orgId, orgId)));
  let studentIds = studentRows.map((s) => s.id);
  if (!studentIds.length) {
    const g = await db.select({ id: guardians.id }).from(guardians).where(and(eq(guardians.userId, userId), eq(guardians.orgId, orgId)));
    if (g.length) {
      const links = await db.select({ studentId: studentGuardians.studentId }).from(studentGuardians).where(inArray(studentGuardians.guardianId, g.map((x) => x.id)));
      studentIds = links.map((l) => l.studentId);
    }
  }
  if (!studentIds.length) return false;
  const enrolled = await db
    .select({ classId: classEnrollments.classId })
    .from(classEnrollments)
    .where(and(inArray(classEnrollments.studentId, studentIds), eq(classEnrollments.status, "active")));
  const classIds = new Set(enrolled.map((e) => e.classId));
  for (const m of materials) {
    if (m.visibility === "all" && classIds.has(m.classId)) return true;
    if (m.visibility === "class" && classIds.has(m.classId)) return true;
    if (m.visibility === "students") {
      const grant = await db.select().from(materialAccess).where(and(eq(materialAccess.materialId, m.id), inArray(materialAccess.studentId, studentIds))).limit(1);
      if (grant[0]) return true;
    }
  }
  for (const l of lessons) {
    if (classIds.has(l.classId)) return true;
  }
  for (const h of hwMatch) {
    if (classIds.has(h.classId)) return true;
  }
  return false;
}

fileRoutes.get("/:id", async (c) => {
  const user = c.get("user")!;
  const member = c.get("member");
  const db = c.get("db");
  const rows = await db.select().from(files).where(eq(files.id, c.req.param("id"))).limit(1);
  const file = rows[0];
  if (!file) return notFound();
  const allowed = await canAccessFile(db, user.id, file.orgId, file.key, member?.orgId === file.orgId);
  if (!allowed) return forbidden("No access to this file");
  const obj = await c.env.FILES.get(file.key);
  if (!obj) return notFound("File missing from storage");
  const headers = new Headers();
  headers.set("content-type", file.mime);
  headers.set("content-disposition", `attachment; filename="${encodeURIComponent(file.name)}"`);
  headers.set("cache-control", "private, max-age=300");
  return new Response(obj.body, { headers });
});

fileRoutes.delete("/:id", requirePerm("materials.manage"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const rows = await db.select().from(files).where(and(eq(files.id, c.req.param("id")), eq(files.orgId, member.orgId))).limit(1);
  if (!rows[0]) return notFound();
  await c.env.FILES.delete(rows[0].key);
  await db.delete(files).where(eq(files.id, rows[0].id));
  return ok({ deleted: true });
});

// ---------- Learning materials ----------

export const materialRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();
materialRoutes.use("*", requireAuth);

materialRoutes.get("/", requirePerm("materials.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const q = new URL(c.req.url).searchParams;
  const classId = q.get("classId");
  const conds = [eq(learningMaterials.orgId, member.orgId), eq(learningMaterials.deletedAt, null as never)];
  const all = await db.select().from(learningMaterials).where(eq(learningMaterials.orgId, member.orgId));
  const filtered = all.filter((m) => !m.deletedAt && (!classId || m.classId === classId));
  const fileIds = filtered.map((m) => m.fileKey).filter(Boolean);
  const fileRows = fileIds.length ? await db.select().from(files).where(inArray(files.key, fileIds as string[])) : [];
  const fileByKey = new Map(fileRows.map((f) => [f.key, f]));
  return ok(filtered.map((m) => ({ ...m, file: m.fileKey ? fileByKey.get(m.fileKey) ?? null : null })));
});

materialRoutes.post("/", requirePerm("materials.manage"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = z
    .object({
      classId: z.string(),
      folder: z.string().max(200).default("General"),
      title: z.string().min(1).max(300),
      type: z.enum(["file", "link"]).default("file"),
      fileId: z.string().optional(),
      url: z.string().url().optional(),
      visibility: z.enum(["all", "class", "batch", "students"]).default("class"),
      studentIds: z.array(z.string()).optional(),
    })
    .parse(await c.req.json());
  let fileRow = null;
  if (body.type === "file") {
    if (!body.fileId) return badRequest("fileId required for file materials");
    fileRow = (await db.select().from(files).where(and(eq(files.id, body.fileId), eq(files.orgId, member.orgId))).limit(1))[0];
    if (!fileRow) return badRequest("File not found");
  } else if (!body.url) {
    return badRequest("url required for link materials");
  }
  const id = uuid();
  await db.insert(learningMaterials).values({
    id,
    orgId: member.orgId,
    classId: body.classId,
    folder: body.folder,
    title: body.title.trim(),
    type: body.type,
    fileKey: fileRow?.key ?? null,
    url: body.url ?? null,
    sizeBytes: fileRow?.sizeBytes ?? null,
    mime: fileRow?.mime ?? null,
    visibility: body.visibility,
    createdBy: user.id,
    createdAt: nowIso(),
  });
  if (body.visibility === "students" && body.studentIds?.length) {
    await db.insert(materialAccess).values(
      body.studentIds.map((sid) => ({ id: uuid(), orgId: member.orgId, materialId: id, studentId: sid, createdAt: nowIso() })),
    );
  }
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "MATERIAL_UPLOADED", entity: "learning_material", entityId: id });
  return ok({ id }, { status: 201 });
});

materialRoutes.delete("/:id", requirePerm("materials.manage"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const rows = await db.select().from(learningMaterials).where(and(eq(learningMaterials.id, c.req.param("id")), eq(learningMaterials.orgId, member.orgId))).limit(1);
  if (!rows[0]) return notFound();
  await db.update(learningMaterials).set({ deletedAt: nowIso() }).where(eq(learningMaterials.id, rows[0].id));
  return ok({ deleted: true });
});

// ---------- Recorded lessons ----------

export const lessonRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();
lessonRoutes.use("*", requireAuth);

lessonRoutes.get("/", requirePerm("lessons.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const classId = new URL(c.req.url).searchParams.get("classId");
  const all = await db.select().from(recordedLessons).where(eq(recordedLessons.orgId, member.orgId));
  return ok(all.filter((l) => !l.deletedAt && (!classId || l.classId === classId)));
});

lessonRoutes.post("/", requirePerm("lessons.manage"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = z
    .object({
      classId: z.string(),
      title: z.string().min(1).max(300),
      date: z.string().optional(),
      durationSeconds: z.number().int().positive().optional(),
      fileId: z.string(),
      visibility: z.enum(["all", "class", "batch", "students"]).default("class"),
    })
    .parse(await c.req.json());
  const fileRow = (await db.select().from(files).where(and(eq(files.id, body.fileId), eq(files.orgId, member.orgId))).limit(1))[0];
  if (!fileRow) return badRequest("File not found");
  const id = uuid();
  await db.insert(recordedLessons).values({
    id,
    orgId: member.orgId,
    classId: body.classId,
    title: body.title.trim(),
    date: body.date ?? null,
    durationSeconds: body.durationSeconds ?? null,
    fileKey: fileRow.key,
    visibility: body.visibility,
    createdBy: user.id,
    createdAt: nowIso(),
  });
  return ok({ id }, { status: 201 });
});

lessonRoutes.delete("/:id", requirePerm("lessons.manage"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const rows = await db.select().from(recordedLessons).where(and(eq(recordedLessons.id, c.req.param("id")), eq(recordedLessons.orgId, member.orgId))).limit(1);
  if (!rows[0]) return notFound();
  await db.update(recordedLessons).set({ deletedAt: nowIso() }).where(eq(recordedLessons.id, rows[0].id));
  return ok({ deleted: true });
});
