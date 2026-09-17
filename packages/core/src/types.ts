/** Shared domain types for ClassFlow. */

export const MEDIUMS = ["sinhala", "tamil", "english"] as const;
export type Medium = (typeof MEDIUMS)[number];

export const ORG_TYPES = ["individual", "institute"] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const STUDENT_STATUSES = ["active", "paused", "transferred", "completed", "dropped"] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const ENROLLMENT_STATUSES = ["active", "paused", "transferred", "completed", "dropped"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const CLASS_TYPES = ["group", "individual", "batch"] as const;
export type ClassType = (typeof CLASS_TYPES)[number];

export const CLASS_MODES = ["physical", "online", "hybrid"] as const;
export type ClassMode = (typeof CLASS_MODES)[number];

export const SESSION_STATUSES = ["scheduled", "cancelled", "rescheduled", "completed"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const FEE_PERIODS = ["monthly", "term", "one_time", "per_class"] as const;
export type FeePeriod = (typeof FEE_PERIODS)[number];

export const FEE_STATUSES = ["pending", "partial", "paid", "waived", "overdue"] as const;
export type FeeStatus = (typeof FEE_STATUSES)[number];

export const PAYMENT_METHODS = ["cash", "bank_transfer", "online", "card"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded", "partially_refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const EXAM_TYPES = ["monthly", "term", "model", "mock", "unit", "final", "custom"] as const;
export type ExamType = (typeof EXAM_TYPES)[number];

export const EXAM_STATUSES = ["draft", "published", "completed"] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];

export const HOMEWORK_STATUSES = ["assigned", "viewed", "submitted", "late", "graded"] as const;
export type HomeworkStatus = (typeof HOMEWORK_STATUSES)[number];

export const VISIBILITIES = ["all", "class", "batch", "students"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const NOTIFICATION_CHANNELS = ["in_app", "email", "sms", "whatsapp"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const PORTAL_ROLES = ["student", "guardian"] as const;

export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface AuthUser {
  id: string;
  email: string | null;
  phone: string | null;
  fullName: string;
  isSuperAdmin: boolean;
}

export interface SessionContext {
  user: AuthUser;
  orgId: string | null;
  memberId: string | null;
  role: string | null;
  permissions: Set<string>;
}
