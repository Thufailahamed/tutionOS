import { eq, and } from "drizzle-orm";
import {
  createDb,
  users,
  authSessions,
  otpCodes,
  organizations,
  organizationMembers,
  subscriptionPlans,
  subscriptions,
  type Database,
} from "@classflow/db";
import { normalizeLKPhone } from "@classflow/core";
import { hashPassword, verifyPassword, randomToken, sha256, uuid, generateOtp } from "../lib/crypto";
import { nowIso, todayColombo, badRequest, unauthorized } from "../lib/http";
import { audit } from "../lib/audit";
import type { Env } from "../env";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export const DEFAULT_SUBJECTS = [
  "Mathematics",
  "Physics",
  "Chemistry",
  "Biology",
  "Combined Mathematics",
  "Science",
  "English",
  "Sinhala",
  "Tamil",
  "History",
  "Geography",
  "Commerce",
  "Accounting",
  "Economics",
  "ICT",
  "Buddhism",
];

export const DEFAULT_GRADES = Array.from({ length: 13 }, (_, i) => `Grade ${i + 1}`);

export const DEFAULT_STREAMS = [
  "Physical Science",
  "Biological Science",
  "Commerce",
  "Arts",
  "Technology",
];

export const DEFAULT_PLANS: {
  code: string;
  name: string;
  priceCents: number;
  studentLimit: number | null;
  teacherLimit: number | null;
  aiCreditsMonthly: number;
  storageGb: number;
  features: string[];
  sortOrder: number;
}[] = [
  {
    code: "free",
    name: "Free",
    priceCents: 0,
    studentLimit: 30,
    teacherLimit: 1,
    aiCreditsMonthly: 0,
    storageGb: 1,
    features: ["classes", "attendance", "dashboard"],
    sortOrder: 0,
  },
  {
    code: "starter",
    name: "Starter",
    priceCents: 250000,
    studentLimit: 100,
    teacherLimit: 3,
    aiCreditsMonthly: 0,
    storageGb: 5,
    features: ["classes", "attendance", "dashboard", "payments", "exams", "reports", "parent_portal"],
    sortOrder: 1,
  },
  {
    code: "pro",
    name: "Pro",
    priceCents: 590000,
    studentLimit: 500,
    teacherLimit: 10,
    aiCreditsMonthly: 200,
    storageGb: 25,
    features: [
      "classes",
      "attendance",
      "dashboard",
      "payments",
      "exams",
      "reports",
      "parent_portal",
      "homework",
      "materials",
      "notifications",
      "analytics",
      "ai",
    ],
    sortOrder: 2,
  },
  {
    code: "institute",
    name: "Institute",
    priceCents: 1490000,
    studentLimit: null,
    teacherLimit: null,
    aiCreditsMonthly: 1000,
    storageGb: 100,
    features: ["*"],
    sortOrder: 3,
  },
];

export async function ensureDefaultPlans(db: Database) {
  const existing = await db.select({ code: subscriptionPlans.code }).from(subscriptionPlans);
  const have = new Set(existing.map((r) => r.code));
  for (const p of DEFAULT_PLANS) {
    if (have.has(p.code)) continue;
    await db.insert(subscriptionPlans).values({
      id: uuid(),
      code: p.code,
      name: p.name,
      priceCents: p.priceCents,
      currency: "LKR",
      interval: "monthly",
      studentLimit: p.studentLimit,
      teacherLimit: p.teacherLimit,
      aiCreditsMonthly: p.aiCreditsMonthly,
      storageGb: p.storageGb,
      featuresJson: JSON.stringify(p.features),
      active: true,
      sortOrder: p.sortOrder,
    });
  }
}

export async function seedOrgReferenceData(db: Database, orgId: string) {
  const { subjects, grades, streams } = await import("@classflow/db");
  const now = nowIso();
  const subjectRows = await db.select().from(subjects).where(eq(subjects.orgId, orgId));
  const gradeRows = await db.select().from(grades).where(eq(grades.orgId, orgId));
  const streamRows = await db.select().from(streams).where(eq(streams.orgId, orgId));
  if (subjectRows.length === 0) {
    await db.insert(subjects).values(
      DEFAULT_SUBJECTS.map((name) => ({ id: uuid(), orgId, name })),
    );
  }
  if (gradeRows.length === 0) {
    await db.insert(grades).values(
      DEFAULT_GRADES.map((name, i) => ({ id: uuid(), orgId, name, sortOrder: i + 1 })),
    );
  }
  if (streamRows.length === 0) {
    await db.insert(streams).values(DEFAULT_STREAMS.map((name) => ({ id: uuid(), orgId, name })));
  }
}

export async function createOrgForUser(
  db: Database,
  userId: string,
  name: string,
  type: "individual" | "institute",
) {
  const now = nowIso();
  const orgId = uuid();
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${orgId.slice(0, 6)}`;
  await db.insert(organizations).values({
    id: orgId,
    name,
    type,
    slug,
    status: "active",
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(organizationMembers).values({
    id: uuid(),
    orgId,
    userId,
    role: "owner",
    status: "active",
    createdAt: now,
  });
  await seedOrgReferenceData(db, orgId);
  await ensureDefaultPlans(db);
  const free = await db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.code, "free"))
    .limit(1);
  if (free[0]) {
    const start = todayColombo();
    const end = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    await db.insert(subscriptions).values({
      id: uuid(),
      orgId,
      planId: free[0].id,
      status: "active",
      currentPeriodStart: start,
      currentPeriodEnd: end,
      createdAt: now,
      updatedAt: now,
    });
  }
  return orgId;
}

export async function createSession(
  db: Database,
  userId: string,
  meta: { userAgent?: string; ip?: string },
) {
  const token = randomToken(32);
  const now = nowIso();
  const sessionId = uuid();
  await db.insert(authSessions).values({
    id: sessionId,
    userId,
    tokenHash: await sha256(token),
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    createdAt: now,
    lastSeenAt: now,
  });
  return { token, sessionId };
}

export async function registerUser(
  db: Database,
  input: { fullName: string; email?: string; phone?: string; password: string },
) {
  const email = input.email?.toLowerCase().trim() || null;
  const phone = input.phone ? normalizeLKPhone(input.phone) : null;
  if (input.phone && !phone) badRequest("Invalid Sri Lankan phone number");
  if (!email && !phone) badRequest("Email or phone is required");

  if (email) {
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing[0]) badRequest("An account with this email already exists");
  }
  if (phone) {
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
    if (existing[0]) badRequest("An account with this phone number already exists");
  }

  const now = nowIso();
  const id = uuid();
  await db.insert(users).values({
    id,
    email,
    phone,
    passwordHash: await hashPassword(input.password),
    fullName: input.fullName.trim(),
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await audit(db, {
    orgId: null,
    actorUserId: id,
    action: "USER_CREATED",
    entity: "user",
    entityId: id,
  });
  return id;
}

export async function loginUser(db: Database, identifier: string, password: string) {
  const idf = identifier.trim();
  const asPhone = normalizeLKPhone(idf);
  const asEmail = idf.toLowerCase();
  const rows = await db
    .select()
    .from(users)
    .where(asPhone ? eq(users.phone, asPhone) : eq(users.email, asEmail))
    .limit(1);
  const user = rows[0];
  if (!user || user.status !== "active" || user.deletedAt) unauthorized("Invalid credentials");
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) unauthorized("Invalid credentials");
  return user;
}

export async function createOtp(
  db: Database,
  input: { channel: "email" | "phone"; destination: string; purpose: string },
) {
  const dest =
    input.channel === "phone" ? normalizeLKPhone(input.destination) : input.destination.toLowerCase().trim();
  if (!dest) return badRequest("Invalid destination");
  const code = generateOtp();
  const now = nowIso();
  await db.insert(otpCodes).values({
    id: uuid(),
    channel: input.channel,
    destination: dest,
    codeHash: await sha256(code),
    purpose: input.purpose,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    createdAt: now,
  });
  return { destination: dest, code };
}

export async function verifyOtp(
  db: Database,
  input: { destination: string; code: string; purpose: string },
) {
  const dest =
    normalizeLKPhone(input.destination) ?? input.destination.toLowerCase().trim();
  const codeHash = await sha256(input.code);
  const rows = await db
    .select()
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.destination, dest),
        eq(otpCodes.purpose, input.purpose),
        eq(otpCodes.codeHash, codeHash),
      ),
    )
    .limit(1);
  const otp = rows[0];
  if (!otp || otp.consumedAt || otp.expiresAt < nowIso()) {
    if (otp) {
      await db.update(otpCodes).set({ attempts: otp.attempts + 1 }).where(eq(otpCodes.id, otp.id));
    }
    badRequest("Invalid or expired code");
  }
  if (otp.attempts >= 5) badRequest("Too many attempts");
  await db.update(otpCodes).set({ consumedAt: nowIso() }).where(eq(otpCodes.id, otp.id));
  return dest;
}
