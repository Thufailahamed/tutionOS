import { z } from "zod";
import {
  MEDIUMS,
  ORG_TYPES,
  STUDENT_STATUSES,
  ENROLLMENT_STATUSES,
  CLASS_TYPES,
  CLASS_MODES,
  SESSION_STATUSES,
  ATTENDANCE_STATUSES,
  FEE_PERIODS,
  PAYMENT_METHODS,
  EXAM_TYPES,
  VISIBILITIES,
} from "./types";

export const phoneSchema = z
  .string()
  .min(9)
  .max(20)
  .transform((s) => s.trim());

export const registerSchema = z
  .object({
    fullName: z.string().min(2).max(120),
    email: z.string().email().optional(),
    phone: phoneSchema.optional(),
    password: z.string().min(8).max(128),
    orgName: z.string().min(2).max(160).optional(),
    orgType: z.enum(ORG_TYPES).optional(),
  })
  .refine((v) => v.email || v.phone, { message: "email or phone required" });

export const loginSchema = z.object({
  identifier: z.string().min(3), // email or phone
  password: z.string().min(1),
});

export const studentSchema = z.object({
  fullName: z.string().min(2).max(160),
  preferredName: z.string().max(80).optional(),
  dateOfBirth: z.string().optional(),
  gender: z.string().max(20).optional(),
  school: z.string().max(160).optional(),
  gradeId: z.string().optional(),
  medium: z.enum(MEDIUMS).optional(),
  streamId: z.string().optional(),
  address: z.string().max(500).optional(),
  phone: phoneSchema.optional(),
  email: z.string().email().optional(),
  emergencyContact: z
    .object({ name: z.string().optional(), phone: phoneSchema.optional(), relationship: z.string().optional() })
    .optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(STUDENT_STATUSES).optional(),
});

export const guardianSchema = z.object({
  fullName: z.string().min(2).max(160),
  phone: phoneSchema,
  email: z.string().email().optional(),
  address: z.string().max(500).optional(),
  relationship: z.string().max(40).optional(),
  isPrimary: z.boolean().optional(),
  receivesNotifications: z.boolean().optional(),
});

export const classSchema = z.object({
  name: z.string().min(2).max(200),
  subjectId: z.string(),
  gradeId: z.string().optional(),
  teacherId: z.string().optional(),
  type: z.enum(CLASS_TYPES).default("group"),
  mode: z.enum(CLASS_MODES).default("physical"),
  medium: z.enum(MEDIUMS).optional(),
  room: z.string().max(80).optional(),
  location: z.string().max(200).optional(),
  capacity: z.number().int().positive().optional(),
  feeCents: z.number().int().min(0).default(0),
  feePeriod: z.enum(FEE_PERIODS).default("monthly"),
  currency: z.string().length(3).default("LKR"),
});

export const scheduleSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().optional(),
});

export const sessionSchema = z.object({
  classId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  status: z.enum(SESSION_STATUSES).optional(),
  substituteTeacherId: z.string().optional(),
  notes: z.string().max(500).optional(),
});

export const attendanceRecordSchema = z.object({
  studentId: z.string(),
  status: z.enum(ATTENDANCE_STATUSES),
  note: z.string().max(300).optional(),
});

export const bulkAttendanceSchema = z.object({
  records: z.array(attendanceRecordSchema).min(1).max(500),
});

export const feePlanSchema = z.object({
  name: z.string().min(2).max(120),
  amountCents: z.number().int().min(0),
  currency: z.string().length(3).default("LKR"),
  period: z.enum(FEE_PERIODS).default("monthly"),
  classId: z.string().optional(),
});

export const paymentSchema = z.object({
  studentId: z.string(),
  amountCents: z.number().int().positive(),
  method: z.enum(PAYMENT_METHODS).default("cash"),
  reference: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
  allocations: z
    .array(z.object({ studentFeeId: z.string(), amountCents: z.number().int().positive() }))
    .optional(),
  paidAt: z.string().optional(),
});

export const examSchema = z.object({
  classId: z.string(),
  title: z.string().min(2).max(200),
  type: z.enum(EXAM_TYPES).default("custom"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationMinutes: z.number().int().positive().optional(),
  maxMarks: z.number().positive().default(100),
  gradingScheme: z.string().max(2000).optional(),
});

export const resultEntrySchema = z.object({
  results: z
    .array(
      z.object({
        studentId: z.string(),
        marks: z.number().min(0).nullable(),
        remarks: z.string().max(300).optional(),
      }),
    )
    .min(1)
    .max(500),
});

export const homeworkSchema = z.object({
  classId: z.string(),
  title: z.string().min(2).max(200),
  description: z.string().max(5000).optional(),
  dueAt: z.string(),
  maxMarks: z.number().positive().optional(),
  attachmentKeys: z.array(z.string()).max(10).optional(),
});

export const materialSchema = z.object({
  classId: z.string(),
  folder: z.string().max(200).default("General"),
  title: z.string().min(1).max(300),
  type: z.enum(["file", "link"]).default("file"),
  url: z.string().url().optional(),
  visibility: z.enum(VISIBILITIES).default("class"),
  studentIds: z.array(z.string()).optional(),
});

export const announcementSchema = z.object({
  title: z.string().min(2).max(200),
  body: z.string().min(1).max(5000),
  audience: z.enum(["all", "class", "students", "parents"]).default("all"),
  classId: z.string().optional(),
  studentIds: z.array(z.string()).optional(),
});

export const messageSchema = z.object({
  body: z.string().min(1).max(4000),
});

export const enrollmentSchema = z.object({
  studentId: z.string(),
  feePlanId: z.string().optional(),
  status: z.enum(ENROLLMENT_STATUSES).optional(),
});

export const csvStudentRowSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  guardian: z.string().optional(),
  guardianPhone: z.string().optional(),
  grade: z.string().optional(),
  class: z.string().optional(),
  fee: z.string().optional(),
});

export const aiQuestionRequestSchema = z.object({
  subject: z.string().min(1),
  grade: z.string().min(1),
  topic: z.string().min(1),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  count: z.number().int().min(1).max(50).default(10),
  questionType: z.enum(["mcq", "short_answer", "structured", "essay", "true_false"]).default("mcq"),
  language: z.enum(["english", "sinhala", "tamil"]).default("english"),
});
