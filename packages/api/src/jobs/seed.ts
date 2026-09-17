import { eq } from "drizzle-orm";
import {
  createDb,
  users,
  organizations,
  organizationMembers,
  subjects,
  grades,
  streams,
  teachers,
  classes,
  classSchedules,
  students,
  guardians,
  studentGuardians,
  classEnrollments,
  classSessions,
  attendanceRecords,
  studentFees,
  payments,
  paymentAllocations,
  exams,
  examResults,
  homework,
  homeworkSubmissions,
  subscriptionPlans,
  subscriptions,
  announcements,
} from "@classflow/db";
import { uuid, hashPassword } from "../lib/crypto";
import { nowIso } from "../lib/http";

/**
 * Demo seed — creates a sample institute with realistic data.
 * Runs only via `pnpm seed` or POST /api/auth/bootstrap — never at request time.
 */
export async function seedDemo(env: { DB: D1Database }): Promise<{ orgId: string }> {
  const db = createDb(env.DB);
  const now = nowIso();
  const today = now.slice(0, 10);

  const password = await hashPassword("password123");
  const mkUser = async (name: string, email: string, phone: string) => {
    const id = uuid();
    await db.insert(users).values({ id, fullName: name, email, phone, passwordHash: password, status: "active", isSuperAdmin: false, createdAt: now, updatedAt: now });
    return id;
  };
  const ownerId = await mkUser("Nimal Perera", "owner@classflow.dev", "+94771234567");
  const teacherUserId = await mkUser("Sandya Fernando", "teacher@classflow.dev", "+94772223344");
  const studentUserId = await mkUser("Kasun Silva", "student@classflow.dev", "+94773334455");
  const guardianUserId = await mkUser("Priya Silva", "parent@classflow.dev", "+94774445566");

  const orgId = uuid();
  await db.insert(organizations).values({
    id: orgId,
    name: "Vidura Institute",
    type: "institute",
    email: "info@vidura.lk",
    phone: "+94112345678",
    address: "42 Galle Road, Colombo 03",
    studentIdPrefix: "VID",
    studentIdSeq: 0,
    settingsJson: "{}",
    status: "active",
    createdBy: ownerId,
    createdAt: now,
    updatedAt: now,
  });

  const mkMember = async (userId: string, role: string) => {
    const id = uuid();
    await db.insert(organizationMembers).values({ id, orgId, userId, role, status: "active", grantsJson: "[]", revokesJson: "[]", createdAt: now });
    return id;
  };
  await mkMember(ownerId, "owner");
  const teacherMemberId = await mkMember(teacherUserId, "teacher");

  // Reference data (subjects/grades/streams have no createdAt column)
  const subjectIds: Record<string, string> = {};
  for (const name of ["Mathematics", "Science", "English", "Physics", "Chemistry", "Biology", "History", "ICT"]) {
    const id = uuid();
    await db.insert(subjects).values({ id, orgId, name });
    subjectIds[name] = id;
  }
  const gradeIds: Record<string, string> = {};
  for (let g = 6; g <= 13; g++) {
    const id = uuid();
    await db.insert(grades).values({ id, orgId, name: `Grade ${g}`, sortOrder: g });
    gradeIds[`Grade ${g}`] = id;
  }
  for (const s of ["Physical Science", "Bio Science", "Commerce", "Arts", "Technology"]) {
    await db.insert(streams).values({ id: uuid(), orgId, name: s });
  }

  // Teacher profile
  const teacherId = uuid();
  await db.insert(teachers).values({
    id: teacherId,
    orgId,
    userId: teacherUserId,
    memberId: teacherMemberId,
    fullName: "Sandya Fernando",
    phone: "+94772223344",
    email: "teacher@classflow.dev",
    subjectsJson: JSON.stringify(["Mathematics", "Science"]),
    status: "active",
    createdAt: now,
  });

  // Classes (subjectId NOT NULL, updatedAt required; room lives on classes)
  const classIds: string[] = [];
  const classDefs = [
    { name: "Mathematics — Grade 11", subject: "Mathematics", grade: "Grade 11", weekday: 1, start: "16:00", end: "18:00", room: "Hall A", fee: 250000 },
    { name: "Mathematics — Grade 10", subject: "Mathematics", grade: "Grade 10", weekday: 3, start: "16:00", end: "18:00", room: "Hall A", fee: 250000 },
    { name: "Science — Grade 11", subject: "Science", grade: "Grade 11", weekday: 5, start: "15:00", end: "17:00", room: "Lab 1", fee: 300000 },
  ];
  for (const def of classDefs) {
    const id = uuid();
    classIds.push(id);
    await db.insert(classes).values({
      id,
      orgId,
      name: def.name,
      subjectId: subjectIds[def.subject]!,
      gradeId: gradeIds[def.grade],
      teacherId,
      type: "group",
      mode: "physical",
      medium: "sinhala",
      room: def.room,
      capacity: 40,
      feeCents: def.fee,
      feePeriod: "monthly",
      currency: "LKR",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(classSchedules).values({
      id: uuid(),
      orgId,
      classId: id,
      weekday: def.weekday,
      startTime: def.start,
      endTime: def.end,
      createdAt: now,
    });
  }

  // Students + guardians + enrollments
  const names = [
    "Kasun Silva", "Amaya Perera", "Tharindu Jayasinghe", "Nethmi Fernando", "Sahan Wickrama",
    "Isuru Bandara", "Dilini Rathnayake", "Chamath Gunasekara", "Shenali Dias", "Pasindu Herath",
    "Kavindi Madushani", "Ravindu Nissanka", "Hiruni Weerasinghe", "Sithum Alwis", "Sanduni Peiris",
  ];
  const firstClassId = classIds[0]!;
  const studentIds: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const sid = uuid();
    studentIds.push(sid);
    const phone = `+9477${String(1000000 + i * 11111).slice(0, 7)}`;
    await db.insert(students).values({
      id: sid,
      orgId,
      studentNo: `VID-${String(i + 1).padStart(6, "0")}`,
      fullName: names[i]!,
      phone,
      userId: i === 0 ? studentUserId : null,
      gradeId: gradeIds[i % 3 === 0 ? "Grade 10" : "Grade 11"]!,
      emergencyContactJson: "{}",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const gid = uuid();
    await db.insert(guardians).values({
      id: gid,
      orgId,
      fullName: `Guardian of ${names[i]!.split(" ")[0]}`,
      phone: `+9471${String(2000000 + i * 22222).slice(0, 7)}`,
      userId: i === 0 ? guardianUserId : null,
      createdAt: now,
    });
    await db.insert(studentGuardians).values({
      id: uuid(),
      orgId,
      studentId: sid,
      guardianId: gid,
      relationship: i % 2 ? "mother" : "father",
      isPrimary: true,
      receivesNotifications: true,
      createdAt: now,
    });
    for (const cid of classIds.slice(0, 2)) {
      await db.insert(classEnrollments).values({ id: uuid(), orgId, classId: cid, studentId: sid, discountCents: 0, status: "active", enrolledAt: now.slice(0, 10) });
    }
  }
  await db.update(organizations).set({ studentIdSeq: names.length }).where(eq(organizations.id, orgId));

  // Materialize sessions + mark past attendance
  const { materializeSessions } = await import("../routes/classes");
  const past = new Date(Date.now() - 21 * 86400e3).toISOString().slice(0, 10);
  await materializeSessions(db, orgId, past, new Date(Date.now() + 14 * 86400e3).toISOString().slice(0, 10));
  const pastSessions = await db.select().from(classSessions).where(eq(classSessions.classId, firstClassId));
  for (const s of pastSessions.filter((x) => x.date < today)) {
    for (const sid of studentIds) {
      const r = Math.random();
      await db.insert(attendanceRecords).values({
        id: uuid(),
        orgId,
        sessionId: s.id,
        classId: firstClassId,
        studentId: sid,
        status: r < 0.8 ? "present" : r < 0.9 ? "absent" : "late",
        recordedBy: ownerId,
        createdAt: now,
        updatedAt: now,
      });
    }
    await db.update(classSessions).set({ status: "completed" }).where(eq(classSessions.id, s.id));
  }

  // Fees + payments (integer cents; allocations link payment→fee)
  const month = today.slice(0, 7);
  let receiptSeq = 1;
  for (const sid of studentIds) {
    const feeId = uuid();
    await db.insert(studentFees).values({
      id: feeId,
      orgId,
      studentId: sid,
      classId: firstClassId,
      label: `Tuition fee — ${month}`,
      periodLabel: month,
      amountCents: 250000,
      discountCents: 0,
      paidCents: 0,
      currency: "LKR",
      status: "pending",
      dueDate: `${month}-10`,
      createdAt: now,
      updatedAt: now,
    });
    if (Math.random() < 0.6) {
      const paid = Math.random() < 0.8 ? 250000 : 150000;
      const payId = uuid();
      await db.insert(payments).values({
        id: payId,
        orgId,
        receiptNo: `RCP-${String(receiptSeq++).padStart(6, "0")}`,
        studentId: sid,
        amountCents: paid,
        method: "cash",
        status: "paid",
        refundedCents: 0,
        currency: "LKR",
        receivedBy: ownerId,
        paidAt: now,
        createdAt: now,
      });
      await db.insert(paymentAllocations).values({ id: uuid(), orgId, paymentId: payId, studentFeeId: feeId, amountCents: paid, createdAt: now });
      await db.update(studentFees).set({ paidCents: paid, status: paid >= 250000 ? "paid" : "partial", updatedAt: now }).where(eq(studentFees.id, feeId));
    }
  }

  // Exam + results (published results get publishedAt)
  const examId = uuid();
  await db.insert(exams).values({
    id: examId,
    orgId,
    classId: firstClassId,
    title: "Term Test 1 — Algebra",
    type: "term",
    date: new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10),
    maxMarks: 100,
    status: "published",
    createdBy: ownerId,
    createdAt: now,
    updatedAt: now,
  });
  for (const sid of studentIds) {
    const marks = Math.floor(Math.random() * 60) + 30;
    const bps = marks * 100;
    const grade = bps >= 7500 ? "A" : bps >= 6500 ? "B" : bps >= 5000 ? "C" : bps >= 3500 ? "S" : "F";
    await db.insert(examResults).values({
      id: uuid(),
      orgId,
      examId,
      studentId: sid,
      marks,
      percentage: bps,
      grade,
      enteredBy: ownerId,
      enteredAt: now,
      publishedAt: now,
    });
  }

  // Homework + auto-assigned submissions
  const hwId = uuid();
  await db.insert(homework).values({
    id: hwId,
    orgId,
    classId: firstClassId,
    title: "Quadratic equations worksheet",
    description: "Complete exercises 1–20 from the handout.",
    dueAt: new Date(Date.now() + 3 * 86400e3).toISOString(),
    maxMarks: 20,
    attachmentsJson: "[]",
    createdBy: teacherUserId,
    createdAt: now,
  });
  for (const sid of studentIds) {
    await db.insert(homeworkSubmissions).values({ id: uuid(), orgId, homeworkId: hwId, studentId: sid, status: "assigned", filesJson: "[]" });
  }

  // Announcement
  await db.insert(announcements).values({
    id: uuid(),
    orgId,
    title: "New term starts next week",
    body: "Classes resume Monday. Please settle outstanding fees.",
    audience: "all",
    classId: null,
    studentIdsJson: "[]",
    createdBy: ownerId,
    createdAt: now,
  });

  // Free-plan subscription
  const planRows = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.code, "free")).limit(1);
  if (planRows[0]) {
    await db.insert(subscriptions).values({
      id: uuid(),
      orgId,
      planId: planRows[0].id,
      status: "active",
      currentPeriodStart: today,
      currentPeriodEnd: new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10),
      createdAt: now,
      updatedAt: now,
    });
  }

  return { orgId };
}
