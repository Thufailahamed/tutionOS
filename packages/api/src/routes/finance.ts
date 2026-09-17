import { Hono } from "hono";
import { eq, and, isNull, sql, desc, gte, lte, asc, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import {
  feePlans,
  studentFees,
  payments,
  paymentAllocations,
  refunds,
  students,
  classes,
  guardians,
  studentGuardians,
  classEnrollments,
  organizations,
  users,
  type Database,
} from "@classflow/db";
import { feePlanSchema, paymentSchema } from "@classflow/core";
import type { Env } from "../env";
import type { ApiVariables } from "../middleware/session";
import { requireAuth, requirePerm } from "../middleware/guard";
import { ok, notFound, badRequest, parsePagination, nowIso, todayColombo } from "../lib/http";
import { audit } from "../lib/audit";
import { uuid } from "../lib/crypto";

export const financeRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

financeRoutes.use("*", requireAuth);

// ---------- Fee plans ----------

financeRoutes.get("/fee-plans", requirePerm("payments.view"), async (c) => {
  const member = c.get("member")!;
  const rows = await c.get("db").select().from(feePlans).where(eq(feePlans.orgId, member.orgId));
  return ok(rows);
});

financeRoutes.post("/fee-plans", requirePerm("fees.manage"), async (c) => {
  const member = c.get("member")!;
  const body = feePlanSchema.parse(await c.req.json());
  const id = uuid();
  await c.get("db").insert(feePlans).values({
    id,
    orgId: member.orgId,
    name: body.name.trim(),
    amountCents: body.amountCents,
    currency: body.currency,
    period: body.period,
    classId: body.classId ?? null,
    active: true,
    createdAt: nowIso(),
  });
  return ok({ id }, { status: 201 });
});

financeRoutes.patch("/fee-plans/:id", requirePerm("fees.manage"), async (c) => {
  const member = c.get("member")!;
  const body = feePlanSchema.partial().extend({ active: z.boolean().optional() }).parse(await c.req.json());
  const rows = await c.get("db").select().from(feePlans).where(and(eq(feePlans.id, c.req.param("id")), eq(feePlans.orgId, member.orgId))).limit(1);
  if (!rows[0]) return notFound();
  await c.get("db").update(feePlans).set(body as Record<string, unknown>).where(eq(feePlans.id, rows[0].id));
  return ok({ updated: true });
});

// ---------- Student fees (charges) ----------

financeRoutes.get("/fees", requirePerm("payments.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const { limit, offset } = parsePagination(c.req.url);
  const q = new URL(c.req.url).searchParams;
  const studentId = q.get("studentId");
  const status = q.get("status");
  const conds = [eq(studentFees.orgId, member.orgId)];
  if (studentId) conds.push(eq(studentFees.studentId, studentId));
  if (status === "outstanding") {
    conds.push(inArray(studentFees.status, ["pending", "partial", "overdue"]));
  } else if (status) {
    conds.push(eq(studentFees.status, status));
  }
  const rows = await db
    .select({ fee: studentFees, studentName: students.fullName, studentNo: students.studentNo, className: classes.name })
    .from(studentFees)
    .innerJoin(students, eq(studentFees.studentId, students.id))
    .leftJoin(classes, eq(studentFees.classId, classes.id))
    .where(and(...conds))
    .orderBy(desc(studentFees.dueDate))
    .limit(limit)
    .offset(offset);
  return ok(rows.map((r) => ({ ...r.fee, studentName: r.studentName, studentNo: r.studentNo, className: r.className })));
});

const createFeeSchema = z.object({
  studentId: z.string(),
  classId: z.string().optional(),
  feePlanId: z.string().optional(),
  label: z.string().min(1).max(200),
  amountCents: z.number().int().positive(),
  discountCents: z.number().int().min(0).default(0),
  currency: z.string().length(3).default("LKR"),
  periodLabel: z.string().max(40).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

financeRoutes.post("/fees", requirePerm("fees.manage"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = createFeeSchema.parse(await c.req.json());
  const st = await db.select().from(students).where(and(eq(students.id, body.studentId), eq(students.orgId, member.orgId))).limit(1);
  if (!st[0]) return badRequest("Student not found");
  const id = uuid();
  const now = nowIso();
  await db.insert(studentFees).values({
    id,
    orgId: member.orgId,
    studentId: body.studentId,
    classId: body.classId ?? null,
    feePlanId: body.feePlanId ?? null,
    label: body.label,
    amountCents: body.amountCents,
    discountCents: body.discountCents,
    currency: body.currency,
    periodLabel: body.periodLabel ?? null,
    dueDate: body.dueDate,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "FEE_CREATED", entity: "student_fee", entityId: id });
  return ok({ id }, { status: 201 });
});

/** Generate this month's fees for all active enrollments with a fee plan. */
financeRoutes.post("/fees/generate", requirePerm("fees.manage"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = z.object({ periodLabel: z.string(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(await c.req.json());
  const enrollments = await db
    .select({ enrollment: classEnrollments, classFeeCents: classes.feeCents, className: classes.name, currency: classes.currency })
    .from(classEnrollments)
    .innerJoin(classes, eq(classEnrollments.classId, classes.id))
    .where(and(eq(classEnrollments.orgId, member.orgId), eq(classEnrollments.status, "active")));
  const existing = await db
    .select({ studentId: studentFees.studentId, classId: studentFees.classId })
    .from(studentFees)
    .where(and(eq(studentFees.orgId, member.orgId), eq(studentFees.periodLabel, body.periodLabel)));
  const already = new Set(existing.map((e) => `${e.studentId}:${e.classId}`));
  let created = 0;
  const now = nowIso();
  for (const e of enrollments) {
    if (e.classFeeCents <= 0) continue;
    const key = `${e.enrollment.studentId}:${e.enrollment.classId}`;
    if (already.has(key)) continue;
    await db.insert(studentFees).values({
      id: uuid(),
      orgId: member.orgId,
      studentId: e.enrollment.studentId,
      classId: e.enrollment.classId,
      feePlanId: e.enrollment.feePlanId ?? null,
      label: `${e.className} — ${body.periodLabel}`,
      amountCents: e.classFeeCents,
      discountCents: e.enrollment.discountCents,
      currency: e.currency,
      periodLabel: body.periodLabel,
      dueDate: body.dueDate,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    created++;
  }
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "FEES_GENERATED", entity: "student_fee", metadata: { period: body.periodLabel, created } });
  return ok({ created, skipped: already.size });
});

financeRoutes.post("/fees/:id/waive", requirePerm("fees.manage"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const rows = await db.select().from(studentFees).where(and(eq(studentFees.id, c.req.param("id")), eq(studentFees.orgId, member.orgId))).limit(1);
  if (!rows[0]) return notFound();
  await db.update(studentFees).set({ status: "waived", updatedAt: nowIso() }).where(eq(studentFees.id, rows[0].id));
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "FEE_WAIVED", entity: "student_fee", entityId: rows[0].id });
  return ok({ waived: true });
});

// ---------- Payments ----------

async function nextReceiptNo(db: Database, orgId: string) {
  const org = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const prefix = "RCP";
  const countRows = await db
    .select({ n: sql<number>`count(*)` })
    .from(payments)
    .where(eq(payments.orgId, orgId));
  return `${prefix}-${String((countRows[0]?.n ?? 0) + 1).padStart(6, "0")}`;
}

async function refreshFeeStatus(db: Database, feeId: string) {
  const fee = (await db.select().from(studentFees).where(eq(studentFees.id, feeId)).limit(1))[0];
  if (!fee || fee.status === "waived") return;
  const due = fee.amountCents - fee.discountCents;
  const today = todayColombo();
  let status: string;
  if (fee.paidCents >= due) status = "paid";
  else if (fee.paidCents > 0) status = "partial";
  else if (fee.dueDate < today) status = "overdue";
  else status = "pending";
  await db.update(studentFees).set({ status, updatedAt: nowIso() }).where(eq(studentFees.id, feeId));
}

financeRoutes.post("/payments", requirePerm("payments.record"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = paymentSchema.parse(await c.req.json());
  const st = await db.select().from(students).where(and(eq(students.id, body.studentId), eq(students.orgId, member.orgId))).limit(1);
  if (!st[0]) return badRequest("Student not found");
  const paymentId = uuid();
  const receiptNo = await nextReceiptNo(db, member.orgId);
  const now = nowIso();
  const primaryGuardian = await db
    .select({ guardianId: studentGuardians.guardianId })
    .from(studentGuardians)
    .where(and(eq(studentGuardians.studentId, body.studentId), eq(studentGuardians.isPrimary, true)))
    .limit(1);

  await db.insert(payments).values({
    id: paymentId,
    orgId: member.orgId,
    receiptNo,
    studentId: body.studentId,
    guardianId: primaryGuardian[0]?.guardianId ?? null,
    amountCents: body.amountCents,
    currency: "LKR",
    method: body.method,
    reference: body.reference ?? null,
    status: "paid",
    receivedBy: user.id,
    paidAt: body.paidAt ?? now,
    note: body.note ?? null,
    createdAt: now,
  });

  // Allocate: explicit allocations, else auto-allocate to oldest outstanding fees
  let remaining = body.amountCents;
  let targets: { id: string }[] = [];
  if (body.allocations?.length) {
    targets = body.allocations.map((a) => ({ id: a.studentFeeId }));
  } else {
    targets = await db
      .select({ id: studentFees.id })
      .from(studentFees)
      .where(
        and(
          eq(studentFees.orgId, member.orgId),
          eq(studentFees.studentId, body.studentId),
          inArray(studentFees.status, ["pending", "partial", "overdue"]),
        ),
      )
      .orderBy(asc(studentFees.dueDate));
  }
  for (const t of targets) {
    if (remaining <= 0) break;
    const fee = (await db.select().from(studentFees).where(and(eq(studentFees.id, t.id), eq(studentFees.orgId, member.orgId))).limit(1))[0];
    if (!fee) continue;
    const explicit = body.allocations?.find((a) => a.studentFeeId === t.id);
    const due = fee.amountCents - fee.discountCents - fee.paidCents;
    const alloc = explicit ? Math.min(explicit.amountCents, due, remaining) : Math.min(due, remaining);
    if (alloc <= 0) continue;
    await db.insert(paymentAllocations).values({
      id: uuid(),
      orgId: member.orgId,
      paymentId,
      studentFeeId: fee.id,
      amountCents: alloc,
      createdAt: now,
    });
    await db.update(studentFees).set({ paidCents: fee.paidCents + alloc, updatedAt: now }).where(eq(studentFees.id, fee.id));
    await refreshFeeStatus(db, fee.id);
    remaining -= alloc;
  }
  await audit(db, {
    orgId: member.orgId,
    actorUserId: user.id,
    action: "PAYMENT_CREATED",
    entity: "payment",
    entityId: paymentId,
    metadata: { amountCents: body.amountCents, method: body.method, receiptNo },
  });
  return ok({ paymentId, receiptNo, unallocatedCents: remaining }, { status: 201 });
});

financeRoutes.get("/payments", requirePerm("payments.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const { limit, offset } = parsePagination(c.req.url);
  const q = new URL(c.req.url).searchParams;
  const studentId = q.get("studentId");
  const from = q.get("from");
  const to = q.get("to");
  const conds = [eq(payments.orgId, member.orgId)];
  if (studentId) conds.push(eq(payments.studentId, studentId));
  if (from) conds.push(gte(payments.paidAt, from));
  if (to) conds.push(lte(payments.paidAt, `${to}T23:59:59Z`));
  const rows = await db
    .select({ payment: payments, studentName: students.fullName, studentNo: students.studentNo, receiverName: users.fullName })
    .from(payments)
    .innerJoin(students, eq(payments.studentId, students.id))
    .innerJoin(users, eq(payments.receivedBy, users.id))
    .where(and(...conds))
    .orderBy(desc(payments.paidAt))
    .limit(limit)
    .offset(offset);
  const totals = await db
    .select({ n: sql<number>`count(*)`, total: sql<number>`coalesce(sum(amount_cents - refunded_cents),0)` })
    .from(payments)
    .where(and(...conds, ne(payments.status, "failed")));
  return ok({
    payments: rows.map((r) => ({ ...r.payment, studentName: r.studentName, studentNo: r.studentNo, receiverName: r.receiverName })),
    count: totals[0]?.n ?? 0,
    totalCents: totals[0]?.total ?? 0,
  });
});

financeRoutes.get("/payments/:id", requirePerm("payments.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const rows = await db
    .select({ payment: payments, studentName: students.fullName, studentNo: students.studentNo, receiverName: users.fullName })
    .from(payments)
    .innerJoin(students, eq(payments.studentId, students.id))
    .innerJoin(users, eq(payments.receivedBy, users.id))
    .where(and(eq(payments.id, c.req.param("id")), eq(payments.orgId, member.orgId)))
    .limit(1);
  if (!rows[0]) return notFound();
  const allocs = await db
    .select({ alloc: paymentAllocations, feeLabel: studentFees.label })
    .from(paymentAllocations)
    .innerJoin(studentFees, eq(paymentAllocations.studentFeeId, studentFees.id))
    .where(eq(paymentAllocations.paymentId, rows[0].payment.id));
  const org = await db.select().from(organizations).where(eq(organizations.id, member.orgId)).limit(1);
  const guardian = rows[0].payment.guardianId
    ? (await db.select().from(guardians).where(eq(guardians.id, rows[0].payment.guardianId)).limit(1))[0]
    : null;
  return ok({
    ...rows[0].payment,
    studentName: rows[0].studentName,
    studentNo: rows[0].studentNo,
    receiverName: rows[0].receiverName,
    guardianName: guardian?.fullName ?? null,
    allocations: allocs.map((a) => ({ ...a.alloc, feeLabel: a.feeLabel })),
    org: org[0] ? { name: org[0].name, address: org[0].address, phone: org[0].phone, logoKey: org[0].logoKey } : null,
  });
});

financeRoutes.post("/payments/:id/refund", requirePerm("payments.refund"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = z.object({ amountCents: z.number().int().positive(), reason: z.string().max(300).optional() }).parse(await c.req.json());
  const rows = await db.select().from(payments).where(and(eq(payments.id, c.req.param("id")), eq(payments.orgId, member.orgId))).limit(1);
  const payment = rows[0];
  if (!payment) return notFound();
  const refundable = payment.amountCents - payment.refundedCents;
  if (body.amountCents > refundable) return badRequest(`Only ${refundable} cents refundable`);
  await db.insert(refunds).values({
    id: uuid(),
    orgId: member.orgId,
    paymentId: payment.id,
    amountCents: body.amountCents,
    reason: body.reason ?? null,
    createdBy: user.id,
    createdAt: nowIso(),
  });
  const newRefunded = payment.refundedCents + body.amountCents;
  const status = newRefunded >= payment.amountCents ? "refunded" : "partially_refunded";
  await db.update(payments).set({ refundedCents: newRefunded, status }).where(eq(payments.id, payment.id));
  // claw back allocations (newest first) and downgrade fee statuses
  const allocs = await db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, payment.id)).orderBy(desc(paymentAllocations.createdAt));
  let toClaw = body.amountCents;
  for (const a of allocs) {
    if (toClaw <= 0) break;
    const claw = Math.min(a.amountCents, toClaw);
    await db.update(paymentAllocations).set({ amountCents: a.amountCents - claw }).where(eq(paymentAllocations.id, a.id));
    const fee = (await db.select().from(studentFees).where(eq(studentFees.id, a.studentFeeId)).limit(1))[0];
    if (fee) {
      await db.update(studentFees).set({ paidCents: Math.max(0, fee.paidCents - claw), updatedAt: nowIso() }).where(eq(studentFees.id, fee.id));
      await refreshFeeStatus(db, fee.id);
    }
    toClaw -= claw;
  }
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "REFUND_CREATED", entity: "payment", entityId: payment.id, metadata: { amountCents: body.amountCents } });
  return ok({ refunded: true });
});

// ---------- Outstanding / student financial profile ----------

financeRoutes.get("/fees/outstanding/summary", requirePerm("payments.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const rows = await db
    .select({
      studentId: studentFees.studentId,
      studentName: students.fullName,
      studentNo: students.studentNo,
      outstanding: sql<number>`sum(${studentFees.amountCents} - ${studentFees.discountCents} - ${studentFees.paidCents})`,
      fees: sql<number>`count(*)`,
      oldestDue: sql<string>`min(${studentFees.dueDate})`,
    })
    .from(studentFees)
    .innerJoin(students, eq(studentFees.studentId, students.id))
    .where(and(eq(studentFees.orgId, member.orgId), inArray(studentFees.status, ["pending", "partial", "overdue"])))
    .groupBy(studentFees.studentId)
    .orderBy(desc(sql`sum(${studentFees.amountCents} - ${studentFees.discountCents} - ${studentFees.paidCents})`));
  const total = rows.reduce((a, r) => a + r.outstanding, 0);
  return ok({ students: rows, totalCents: total, count: rows.length });
});

financeRoutes.get("/students/:studentId/finance", requirePerm("payments.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const studentId = c.req.param("studentId");
  const fees = await db
    .select()
    .from(studentFees)
    .where(and(eq(studentFees.orgId, member.orgId), eq(studentFees.studentId, studentId)))
    .orderBy(desc(studentFees.dueDate));
  const pays = await db
    .select()
    .from(payments)
    .where(and(eq(payments.orgId, member.orgId), eq(payments.studentId, studentId)))
    .orderBy(desc(payments.paidAt));
  const outstanding = fees
    .filter((f) => ["pending", "partial", "overdue"].includes(f.status))
    .reduce((a, f) => a + (f.amountCents - f.discountCents - f.paidCents), 0);
  const paidTotal = pays.filter((p) => p.status !== "failed").reduce((a, p) => a + p.amountCents - p.refundedCents, 0);
  const nextDue = fees.filter((f) => ["pending", "partial", "overdue"].includes(f.status)).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]?.dueDate ?? null;
  return ok({ fees, payments: pays, outstandingCents: outstanding, paidTotalCents: paidTotal, nextDueDate: nextDue });
});

/** Per-student fee summary for a specific fee record */
financeRoutes.get("/fees/:id", requirePerm("payments.view"), async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const rows = await db
    .select({ fee: studentFees, studentName: students.fullName })
    .from(studentFees)
    .innerJoin(students, eq(studentFees.studentId, students.id))
    .where(and(eq(studentFees.id, c.req.param("id")), eq(studentFees.orgId, member.orgId)))
    .limit(1);
  if (!rows[0]) return notFound();
  const allocs = await db.select().from(paymentAllocations).where(eq(paymentAllocations.studentFeeId, rows[0].fee.id));
  return ok({ ...rows[0].fee, studentName: rows[0].studentName, allocations: allocs });
});
