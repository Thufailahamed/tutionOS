import { Hono } from "hono";
import { eq, and, sql, desc, gte, ne } from "drizzle-orm";
import { z } from "zod";
import {
  subscriptionPlans,
  subscriptions,
  organizations,
  organizationMembers,
  students,
  users,
  platformInvoices,
  aiUsage,
  payments,
  classes,
} from "@classflow/db";
import type { Env } from "../env";
import type { ApiVariables } from "../middleware/session";
import { requireAuth, requireMember, requirePerm, requireSuperAdmin } from "../middleware/guard";
import { ok, notFound, badRequest, nowIso, todayColombo } from "../lib/http";
import { audit } from "../lib/audit";
import { uuid } from "../lib/crypto";
import { ensureDefaultPlans } from "../services/auth";

export const billingRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

billingRoutes.use("*", requireAuth);

billingRoutes.get("/plans", async (c) => {
  const db = c.get("db");
  await ensureDefaultPlans(db);
  const rows = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.active, true)).orderBy(subscriptionPlans.sortOrder);
  return ok(rows.map((r) => ({ ...r, features: JSON.parse(r.featuresJson || "[]") })));
});

billingRoutes.get("/subscription", requireMember, async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const rows = await db
    .select({ sub: subscriptions, plan: subscriptionPlans })
    .from(subscriptions)
    .innerJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
    .where(and(eq(subscriptions.orgId, member.orgId), eq(subscriptions.status, "active")))
    .limit(1);
  const usage = await currentUsage(db, member.orgId);
  if (!rows[0]) return ok({ subscription: null, usage });
  return ok({
    subscription: { ...rows[0].sub, plan: { ...rows[0].plan, features: JSON.parse(rows[0].plan.featuresJson || "[]") } },
    usage,
  });
});

async function currentUsage(db: ReturnType<typeof import("@classflow/db").createDb>, orgId: string) {
  const monthStart = `${todayColombo().slice(0, 7)}-01`;
  const [studentCount, teacherCount, ai] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(students).where(and(eq(students.orgId, orgId), eq(students.status, "active"))),
    db.select({ n: sql<number>`count(*)` }).from(organizationMembers).where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.role, "teacher"), eq(organizationMembers.status, "active"))),
    db.select({ n: sql<number>`coalesce(sum(${aiUsage.units}),0)` }).from(aiUsage).where(and(eq(aiUsage.orgId, orgId), gte(aiUsage.createdAt, monthStart))),
  ]);
  return { students: studentCount[0]?.n ?? 0, teachers: teacherCount[0]?.n ?? 0, aiCreditsUsed: ai[0]?.n ?? 0 };
}

billingRoutes.post("/subscription/change", requirePerm("billing.manage"), async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = z.object({ planCode: z.string() }).parse(await c.req.json());
  const plan = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.code, body.planCode)).limit(1);
  if (!plan[0]) return badRequest("Unknown plan");
  const now = nowIso();
  const start = todayColombo();
  const end = new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);
  // cancel current, start new
  await db.update(subscriptions).set({ status: "cancelled", updatedAt: now }).where(and(eq(subscriptions.orgId, member.orgId), eq(subscriptions.status, "active")));
  const id = uuid();
  await db.insert(subscriptions).values({
    id,
    orgId: member.orgId,
    planId: plan[0].id,
    status: "active",
    currentPeriodStart: start,
    currentPeriodEnd: end,
    createdAt: now,
    updatedAt: now,
  });
  if (plan[0].priceCents > 0) {
    await db.insert(platformInvoices).values({
      id: uuid(),
      orgId: member.orgId,
      subscriptionId: id,
      amountCents: plan[0].priceCents,
      currency: "LKR",
      status: "due",
      issuedAt: now,
    });
  }
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "SUBSCRIPTION_CHANGED", entity: "subscription", entityId: id, metadata: { plan: body.planCode } });
  return ok({ subscriptionId: id, plan: plan[0].name });
});

billingRoutes.get("/invoices", requirePerm("billing.manage"), async (c) => {
  const member = c.get("member")!;
  const rows = await c.get("db").select().from(platformInvoices).where(eq(platformInvoices.orgId, member.orgId)).orderBy(desc(platformInvoices.issuedAt));
  return ok(rows);
});

/** Feature gate check the UI can call before showing gated features. */
billingRoutes.get("/entitlements", requireMember, async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const rows = await db
    .select({ plan: subscriptionPlans })
    .from(subscriptions)
    .innerJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
    .where(and(eq(subscriptions.orgId, member.orgId), eq(subscriptions.status, "active")))
    .limit(1);
  const plan = rows[0]?.plan;
  const features: string[] = plan ? JSON.parse(plan.featuresJson || "[]") : [];
  const all = features.includes("*");
  return ok({
    plan: plan ? { code: plan.code, name: plan.name } : null,
    studentLimit: plan?.studentLimit ?? null,
    teacherLimit: plan?.teacherLimit ?? null,
    aiCreditsMonthly: plan?.aiCreditsMonthly ?? 0,
    features,
    can: (f: string) => all || features.includes(f),
    flags: {
      payments: all || features.includes("payments"),
      exams: all || features.includes("exams"),
      homework: all || features.includes("homework"),
      materials: all || features.includes("materials"),
      ai: all || features.includes("ai"),
      notifications: all || features.includes("notifications"),
      parentPortal: all || features.includes("parent_portal"),
      reports: all || features.includes("reports"),
    },
  });
});

// ---------- Super Admin ----------

export const adminRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();
adminRoutes.use("*", requireSuperAdmin);

adminRoutes.get("/overview", async (c) => {
  const db = c.get("db");
  const [orgCount, userCount, studentCount, classCount, subCount, revenue, recent] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(organizations).where(ne(organizations.status, "deleted")),
    db.select({ n: sql<number>`count(*)` }).from(users),
    db.select({ n: sql<number>`count(*)` }).from(students),
    db.select({ n: sql<number>`count(*)` }).from(classes).where(eq(classes.status, "active")),
    db.select({ n: sql<number>`count(*)` }).from(subscriptions).where(eq(subscriptions.status, "active")),
    db.select({ total: sql<number>`coalesce(sum(${platformInvoices.amountCents}),0)` }).from(platformInvoices).where(eq(platformInvoices.status, "paid")),
    db.select({ n: sql<number>`count(*)` }).from(organizations).where(gte(organizations.createdAt, new Date(Date.now() - 30 * 86400e3).toISOString())),
  ]);
  return ok({
    organizations: orgCount[0]?.n ?? 0,
    users: userCount[0]?.n ?? 0,
    students: studentCount[0]?.n ?? 0,
    activeClasses: classCount[0]?.n ?? 0,
    activeSubscriptions: subCount[0]?.n ?? 0,
    platformRevenueCents: revenue[0]?.total ?? 0,
    newOrgs30d: recent[0]?.n ?? 0,
  });
});

adminRoutes.get("/organizations", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select({
      org: organizations,
      members: sql<number>`(select count(*) from organization_members m where m.org_id = ${organizations.id} and m.status='active')`,
      students: sql<number>`(select count(*) from students s where s.org_id = ${organizations.id} and s.deleted_at is null)`,
      planCode: subscriptionPlans.code,
    })
    .from(organizations)
    .leftJoin(subscriptions, and(eq(subscriptions.orgId, organizations.id), eq(subscriptions.status, "active")))
    .leftJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
    .orderBy(desc(organizations.createdAt));
  return ok(rows.map((r) => ({ ...r.org, members: r.members, students: r.students, planCode: r.planCode })));
});

adminRoutes.post("/organizations/:id/status", async (c) => {
  const db = c.get("db");
  const body = z.object({ status: z.enum(["active", "suspended"]) }).parse(await c.req.json());
  const rows = await db.select().from(organizations).where(eq(organizations.id, c.req.param("id"))).limit(1);
  if (!rows[0]) return notFound();
  await db.update(organizations).set({ status: body.status, updatedAt: nowIso() }).where(eq(organizations.id, rows[0].id));
  await audit(db, { orgId: rows[0].id, actorUserId: c.get("user")!.id, action: "ORG_STATUS_CHANGED", entity: "organization", entityId: rows[0].id, metadata: { status: body.status } });
  return ok({ updated: true });
});

adminRoutes.get("/users", async (c) => {
  const db = c.get("db");
  const rows = await db.select({ id: users.id, email: users.email, phone: users.phone, fullName: users.fullName, isSuperAdmin: users.isSuperAdmin, status: users.status, createdAt: users.createdAt }).from(users).orderBy(desc(users.createdAt)).limit(500);
  return ok(rows);
});

adminRoutes.get("/plans", async (c) => {
  const db = c.get("db");
  await ensureDefaultPlans(db);
  const rows = await db.select().from(subscriptionPlans).orderBy(subscriptionPlans.sortOrder);
  return ok(rows.map((r) => ({ ...r, features: JSON.parse(r.featuresJson || "[]") })));
});

adminRoutes.patch("/plans/:id", async (c) => {
  const db = c.get("db");
  const body = z
    .object({
      name: z.string().optional(),
      priceCents: z.number().int().min(0).optional(),
      studentLimit: z.number().int().nullable().optional(),
      teacherLimit: z.number().int().nullable().optional(),
      aiCreditsMonthly: z.number().int().min(0).optional(),
      storageGb: z.number().int().min(0).optional(),
      features: z.array(z.string()).optional(),
      active: z.boolean().optional(),
    })
    .parse(await c.req.json());
  const rows = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, c.req.param("id"))).limit(1);
  if (!rows[0]) return notFound();
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    if (k === "features") patch.featuresJson = JSON.stringify(v);
    else patch[k] = v;
  }
  await db.update(subscriptionPlans).set(patch).where(eq(subscriptionPlans.id, rows[0].id));
  return ok({ updated: true });
});

adminRoutes.get("/invoices", async (c) => {
  const rows = await c.get("db").select().from(platformInvoices).orderBy(desc(platformInvoices.issuedAt)).limit(200);
  return ok(rows);
});
