import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ---------- Identity & auth ----------

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").unique(),
  phone: text("phone").unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  avatarKey: text("avatar_key"),
  isSuperAdmin: integer("is_super_admin", { mode: "boolean" }).notNull().default(false),
  emailVerifiedAt: text("email_verified_at"),
  phoneVerifiedAt: text("phone_verified_at"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull().unique(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at"),
    revokedAt: text("revoked_at"),
  },
  (t) => [index("idx_auth_sessions_user").on(t.userId)],
);

export const otpCodes = sqliteTable(
  "otp_codes",
  {
    id: text("id").primaryKey(),
    channel: text("channel").notNull(), // email | phone
    destination: text("destination").notNull(),
    codeHash: text("code_hash").notNull(),
    purpose: text("purpose").notNull(), // verify_email | verify_phone | password_reset | login
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_otp_dest").on(t.destination, t.purpose)],
);

// ---------- Tenancy ----------

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("institute"), // individual | institute
  slug: text("slug").unique(),
  logoKey: text("logo_key"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  status: text("status").notNull().default("active"), // active | suspended
  settingsJson: text("settings_json").notNull().default("{}"),
  studentIdPrefix: text("student_id_prefix").notNull().default("CLS"),
  studentIdSeq: integer("student_id_seq").notNull().default(0),
  attendanceAlertThreshold: integer("attendance_alert_threshold").notNull().default(80),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const organizationMembers = sqliteTable(
  "organization_members",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    userId: text("user_id").notNull().references(() => users.id),
    role: text("role").notNull(), // owner | admin | teacher | staff
    grantsJson: text("grants_json").notNull().default("[]"),
    revokesJson: text("revokes_json").notNull().default("[]"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_org_member").on(t.orgId, t.userId),
    index("idx_member_user").on(t.userId),
  ],
);

export const invites = sqliteTable("invites", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  email: text("email"),
  phone: text("phone"),
  role: text("role").notNull().default("staff"),
  token: text("token").notNull().unique(),
  status: text("status").notNull().default("pending"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

// ---------- Reference data (org-owned or global org_id=null) ----------

export const subjects = sqliteTable(
  "subjects",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").references(() => organizations.id),
    name: text("name").notNull(),
    code: text("code"),
  },
  (t) => [index("idx_subjects_org").on(t.orgId)],
);

export const grades = sqliteTable(
  "grades",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").references(() => organizations.id),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("idx_grades_org").on(t.orgId)],
);

export const streams = sqliteTable(
  "streams",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").references(() => organizations.id),
    name: text("name").notNull(),
  },
  (t) => [index("idx_streams_org").on(t.orgId)],
);

// ---------- People ----------

export const students = sqliteTable(
  "students",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    studentNo: text("student_no").notNull(),
    userId: text("user_id").references(() => users.id),
    fullName: text("full_name").notNull(),
    preferredName: text("preferred_name"),
    dateOfBirth: text("date_of_birth"),
    gender: text("gender"),
    school: text("school"),
    gradeId: text("grade_id").references(() => grades.id),
    medium: text("medium"),
    streamId: text("stream_id").references(() => streams.id),
    address: text("address"),
    phone: text("phone"),
    email: text("email"),
    photoKey: text("photo_key"),
    emergencyContactJson: text("emergency_contact_json").notNull().default("{}"),
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    uniqueIndex("uq_student_no").on(t.orgId, t.studentNo),
    index("idx_students_org").on(t.orgId),
    index("idx_students_name").on(t.orgId, t.fullName),
    index("idx_students_user").on(t.userId),
  ],
);

export const guardians = sqliteTable(
  "guardians",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    userId: text("user_id").references(() => users.id),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    address: text("address"),
    createdAt: text("created_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("idx_guardians_org").on(t.orgId), index("idx_guardians_user").on(t.userId)],
);

export const studentGuardians = sqliteTable(
  "student_guardians",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    studentId: text("student_id").notNull().references(() => students.id),
    guardianId: text("guardian_id").notNull().references(() => guardians.id),
    relationship: text("relationship").notNull().default("guardian"),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    receivesNotifications: integer("receives_notifications", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_student_guardian").on(t.studentId, t.guardianId),
    index("idx_sg_guardian").on(t.guardianId),
  ],
);

export const teachers = sqliteTable(
  "teachers",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    userId: text("user_id").references(() => users.id),
    memberId: text("member_id").references(() => organizationMembers.id),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    email: text("email"),
    subjectsJson: text("subjects_json").notNull().default("[]"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("idx_teachers_org").on(t.orgId)],
);

// ---------- Classes & scheduling ----------

export const classes = sqliteTable(
  "classes",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    subjectId: text("subject_id").notNull().references(() => subjects.id),
    gradeId: text("grade_id").references(() => grades.id),
    teacherId: text("teacher_id").references(() => teachers.id),
    type: text("type").notNull().default("group"),
    mode: text("mode").notNull().default("physical"),
    medium: text("medium"),
    room: text("room"),
    location: text("location"),
    capacity: integer("capacity"),
    feeCents: integer("fee_cents").notNull().default(0),
    feePeriod: text("fee_period").notNull().default("monthly"),
    currency: text("currency").notNull().default("LKR"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("idx_classes_org").on(t.orgId), index("idx_classes_teacher").on(t.teacherId)],
);

export const classSchedules = sqliteTable(
  "class_schedules",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    classId: text("class_id").notNull().references(() => classes.id),
    weekday: integer("weekday").notNull(), // 0=Sun
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    effectiveFrom: text("effective_from"),
    effectiveTo: text("effective_to"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_schedules_class").on(t.classId), index("idx_schedules_org").on(t.orgId)],
);

export const classSessions = sqliteTable(
  "class_sessions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    classId: text("class_id").notNull().references(() => classes.id),
    scheduleId: text("schedule_id").references(() => classSchedules.id),
    date: text("date").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    status: text("status").notNull().default("scheduled"),
    substituteTeacherId: text("substitute_teacher_id").references(() => teachers.id),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_sessions_class_date").on(t.classId, t.date),
    index("idx_sessions_org_date").on(t.orgId, t.date),
    uniqueIndex("uq_session").on(t.classId, t.date, t.startTime),
  ],
);

export const classEnrollments = sqliteTable(
  "class_enrollments",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    classId: text("class_id").notNull().references(() => classes.id),
    studentId: text("student_id").notNull().references(() => students.id),
    feePlanId: text("fee_plan_id"),
    discountCents: integer("discount_cents").notNull().default(0),
    status: text("status").notNull().default("active"),
    enrolledAt: text("enrolled_at").notNull(),
    leftAt: text("left_at"),
  },
  (t) => [
    uniqueIndex("uq_enrollment").on(t.classId, t.studentId),
    index("idx_enroll_student").on(t.studentId),
  ],
);

export const classWaitlist = sqliteTable(
  "class_waitlist",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    classId: text("class_id").notNull().references(() => classes.id),
    studentId: text("student_id").notNull().references(() => students.id),
    position: integer("position").notNull(),
    status: text("status").notNull().default("waiting"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_waitlist_class").on(t.classId, t.status)],
);

// ---------- Attendance ----------

export const attendanceRecords = sqliteTable(
  "attendance_records",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    sessionId: text("session_id").notNull().references(() => classSessions.id),
    classId: text("class_id").notNull().references(() => classes.id),
    studentId: text("student_id").notNull().references(() => students.id),
    status: text("status").notNull(),
    note: text("note"),
    recordedBy: text("recorded_by").notNull().references(() => users.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_attendance").on(t.sessionId, t.studentId),
    index("idx_attendance_student").on(t.studentId),
    index("idx_attendance_org").on(t.orgId),
  ],
);

// ---------- Finance (integer minor units only) ----------

export const feePlans = sqliteTable(
  "fee_plans",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("LKR"),
    period: text("period").notNull().default("monthly"),
    classId: text("class_id").references(() => classes.id),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_fee_plans_org").on(t.orgId)],
);

export const studentFees = sqliteTable(
  "student_fees",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    studentId: text("student_id").notNull().references(() => students.id),
    classId: text("class_id").references(() => classes.id),
    feePlanId: text("fee_plan_id").references(() => feePlans.id),
    label: text("label").notNull(),
    amountCents: integer("amount_cents").notNull(),
    discountCents: integer("discount_cents").notNull().default(0),
    paidCents: integer("paid_cents").notNull().default(0),
    currency: text("currency").notNull().default("LKR"),
    periodLabel: text("period_label"),
    dueDate: text("due_date").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_fees_student").on(t.studentId),
    index("idx_fees_org_due").on(t.orgId, t.dueDate),
    index("idx_fees_status").on(t.orgId, t.status),
  ],
);

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    receiptNo: text("receipt_no").notNull(),
    studentId: text("student_id").notNull().references(() => students.id),
    guardianId: text("guardian_id").references(() => guardians.id),
    amountCents: integer("amount_cents").notNull(),
    refundedCents: integer("refunded_cents").notNull().default(0),
    currency: text("currency").notNull().default("LKR"),
    method: text("method").notNull().default("cash"),
    reference: text("reference"),
    status: text("status").notNull().default("paid"),
    receivedBy: text("received_by").notNull().references(() => users.id),
    paidAt: text("paid_at").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_receipt").on(t.orgId, t.receiptNo),
    index("idx_payments_student").on(t.studentId),
    index("idx_payments_org_date").on(t.orgId, t.paidAt),
  ],
);

export const paymentAllocations = sqliteTable(
  "payment_allocations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    paymentId: text("payment_id").notNull().references(() => payments.id),
    studentFeeId: text("student_fee_id").notNull().references(() => studentFees.id),
    amountCents: integer("amount_cents").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_alloc_payment").on(t.paymentId), index("idx_alloc_fee").on(t.studentFeeId)],
);

export const refunds = sqliteTable(
  "refunds",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    paymentId: text("payment_id").notNull().references(() => payments.id),
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason"),
    createdBy: text("created_by").notNull().references(() => users.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_refunds_payment").on(t.paymentId)],
);

// ---------- Exams & results ----------

export const exams = sqliteTable(
  "exams",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    classId: text("class_id").notNull().references(() => classes.id),
    title: text("title").notNull(),
    type: text("type").notNull().default("custom"),
    date: text("date").notNull(),
    durationMinutes: integer("duration_minutes"),
    maxMarks: integer("max_marks").notNull().default(100),
    gradingScheme: text("grading_scheme"),
    status: text("status").notNull().default("draft"),
    createdBy: text("created_by").notNull().references(() => users.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("idx_exams_org").on(t.orgId), index("idx_exams_class").on(t.classId), index("idx_exams_date").on(t.orgId, t.date)],
);

export const examResults = sqliteTable(
  "exam_results",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    examId: text("exam_id").notNull().references(() => exams.id),
    studentId: text("student_id").notNull().references(() => students.id),
    marks: integer("marks"),
    percentage: integer("percentage"), // 0-10000 basis points
    grade: text("grade"),
    rank: integer("rank"),
    remarks: text("remarks"),
    enteredBy: text("entered_by").notNull().references(() => users.id),
    enteredAt: text("entered_at").notNull(),
    publishedAt: text("published_at"),
  },
  (t) => [
    uniqueIndex("uq_exam_result").on(t.examId, t.studentId),
    index("idx_results_student").on(t.studentId),
  ],
);

// ---------- Homework ----------

export const homework = sqliteTable(
  "homework",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    classId: text("class_id").notNull().references(() => classes.id),
    title: text("title").notNull(),
    description: text("description"),
    dueAt: text("due_at").notNull(),
    maxMarks: integer("max_marks"),
    attachmentsJson: text("attachments_json").notNull().default("[]"),
    createdBy: text("created_by").notNull().references(() => users.id),
    createdAt: text("created_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("idx_homework_org").on(t.orgId), index("idx_homework_class").on(t.classId)],
);

export const homeworkSubmissions = sqliteTable(
  "homework_submissions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    homeworkId: text("homework_id").notNull().references(() => homework.id),
    studentId: text("student_id").notNull().references(() => students.id),
    status: text("status").notNull().default("assigned"),
    filesJson: text("files_json").notNull().default("[]"),
    submittedAt: text("submitted_at"),
    viewedAt: text("viewed_at"),
    marks: integer("marks"),
    feedback: text("feedback"),
    gradedBy: text("graded_by").references(() => users.id),
    gradedAt: text("graded_at"),
  },
  (t) => [uniqueIndex("uq_hw_submission").on(t.homeworkId, t.studentId), index("idx_hw_sub_student").on(t.studentId)],
);

// ---------- Learning content ----------

export const learningMaterials = sqliteTable(
  "learning_materials",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    classId: text("class_id").notNull().references(() => classes.id),
    folder: text("folder").notNull().default("General"),
    title: text("title").notNull(),
    type: text("type").notNull().default("file"),
    fileKey: text("file_key"),
    url: text("url"),
    sizeBytes: integer("size_bytes"),
    mime: text("mime"),
    visibility: text("visibility").notNull().default("class"),
    createdBy: text("created_by").notNull().references(() => users.id),
    createdAt: text("created_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("idx_materials_class").on(t.classId), index("idx_materials_org").on(t.orgId)],
);

export const materialAccess = sqliteTable(
  "material_access",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    materialId: text("material_id").notNull().references(() => learningMaterials.id),
    studentId: text("student_id").notNull().references(() => students.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("uq_material_access").on(t.materialId, t.studentId)],
);

export const recordedLessons = sqliteTable(
  "recorded_lessons",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    classId: text("class_id").notNull().references(() => classes.id),
    title: text("title").notNull(),
    date: text("date"),
    durationSeconds: integer("duration_seconds"),
    fileKey: text("file_key").notNull(),
    visibility: text("visibility").notNull().default("class"),
    createdBy: text("created_by").notNull().references(() => users.id),
    createdAt: text("created_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("idx_lessons_class").on(t.classId)],
);

// ---------- Communication ----------

export const announcements = sqliteTable(
  "announcements",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    title: text("title").notNull(),
    body: text("body").notNull(),
    audience: text("audience").notNull().default("all"),
    classId: text("class_id").references(() => classes.id),
    studentIdsJson: text("student_ids_json").notNull().default("[]"),
    createdBy: text("created_by").notNull().references(() => users.id),
    createdAt: text("created_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("idx_announcements_org").on(t.orgId, t.createdAt)],
);

export const messageThreads = sqliteTable(
  "message_threads",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    kind: text("kind").notNull().default("direct"),
    subject: text("subject"),
    studentId: text("student_id").references(() => students.id),
    createdBy: text("created_by").notNull().references(() => users.id),
    createdAt: text("created_at").notNull(),
    lastMessageAt: text("last_message_at"),
  },
  (t) => [index("idx_threads_org").on(t.orgId)],
);

export const messageParticipants = sqliteTable(
  "message_participants",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull().references(() => messageThreads.id),
    userId: text("user_id").notNull().references(() => users.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("uq_thread_participant").on(t.threadId, t.userId)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    threadId: text("thread_id").notNull().references(() => messageThreads.id),
    senderUserId: text("sender_user_id").notNull().references(() => users.id),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_messages_thread").on(t.threadId, t.createdAt)],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").references(() => organizations.id),
    userId: text("user_id").notNull().references(() => users.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    actionUrl: text("action_url"),
    status: text("status").notNull().default("unread"),
    createdAt: text("created_at").notNull(),
    readAt: text("read_at"),
  },
  (t) => [index("idx_notifications_user").on(t.userId, t.status)],
);

export const notificationLog = sqliteTable(
  "notification_log",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").references(() => organizations.id),
    channel: text("channel").notNull(),
    provider: text("provider").notNull(),
    recipient: text("recipient").notNull(),
    body: text("body").notNull(),
    status: text("status").notNull(),
    costCents: integer("cost_cents"),
    error: text("error"),
    idempotencyKey: text("idempotency_key").unique(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_notif_log_org").on(t.orgId, t.createdAt)],
);

export const notificationPreferences = sqliteTable(
  "notification_preferences",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    type: text("type").notNull(),
    channel: text("channel").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [uniqueIndex("uq_notif_pref").on(t.userId, t.type, t.channel)],
);

// ---------- SaaS / billing ----------

export const subscriptionPlans = sqliteTable("subscription_plans", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  priceCents: integer("price_cents").notNull().default(0),
  currency: text("currency").notNull().default("LKR"),
  interval: text("interval").notNull().default("monthly"),
  studentLimit: integer("student_limit"),
  teacherLimit: integer("teacher_limit"),
  aiCreditsMonthly: integer("ai_credits_monthly").notNull().default(0),
  storageGb: integer("storage_gb").notNull().default(1),
  featuresJson: text("features_json").notNull().default("[]"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    planId: text("plan_id").notNull().references(() => subscriptionPlans.id),
    status: text("status").notNull().default("active"),
    currentPeriodStart: text("current_period_start").notNull(),
    currentPeriodEnd: text("current_period_end").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("idx_subs_org").on(t.orgId, t.status)],
);

export const platformInvoices = sqliteTable("platform_invoices", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  subscriptionId: text("subscription_id").references(() => subscriptions.id),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("LKR"),
  status: text("status").notNull().default("due"),
  issuedAt: text("issued_at").notNull(),
  paidAt: text("paid_at"),
});

// ---------- Files / certificates / AI / audit ----------

export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    mime: text("mime").notNull(),
    kind: text("kind").notNull().default("generic"),
    ownerUserId: text("owner_user_id").references(() => users.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_files_org").on(t.orgId)],
);

export const certificates = sqliteTable(
  "certificates",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    studentId: text("student_id").notNull().references(() => students.id),
    classId: text("class_id").references(() => classes.id),
    type: text("type").notNull().default("completion"),
    title: text("title").notNull(),
    fileKey: text("file_key"),
    issuedBy: text("issued_by").notNull().references(() => users.id),
    issuedAt: text("issued_at").notNull(),
  },
  (t) => [index("idx_certs_student").on(t.studentId)],
);

export const aiGenerations = sqliteTable(
  "ai_generations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("draft"), // draft | approved | rejected | published
    inputJson: text("input_json").notNull().default("{}"),
    outputJson: text("output_json").notNull().default("{}"),
    model: text("model"),
    error: text("error"),
    createdBy: text("created_by").notNull().references(() => users.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("idx_ai_org").on(t.orgId, t.kind)],
);

export const aiUsage = sqliteTable(
  "ai_usage",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    kind: text("kind").notNull(),
    units: integer("units").notNull().default(1),
    model: text("model"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_ai_usage_org").on(t.orgId, t.createdAt)],
);

export const importJobs = sqliteTable(
  "import_jobs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    kind: text("kind").notNull().default("students_csv"),
    status: text("status").notNull().default("pending"), // pending | processing | done | failed
    total: integer("total").notNull().default(0),
    processed: integer("processed").notNull().default(0),
    errorsJson: text("errors_json").notNull().default("[]"),
    payloadJson: text("payload_json").notNull().default("{}"),
    createdBy: text("created_by").notNull().references(() => users.id),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (t) => [index("idx_imports_org").on(t.orgId)],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").references(() => organizations.id),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_audit_org").on(t.orgId, t.createdAt), index("idx_audit_entity").on(t.entity, t.entityId)],
);

// ---------- Scheduled job helpers ----------

export const sentReminders = sqliteTable(
  "sent_reminders",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    kind: text("kind").notNull(), // fee_due | class_reminder | exam_reminder | homework_reminder
    refKey: text("ref_key").notNull(),
    sentAt: text("sent_at").notNull(),
  },
  (t) => [uniqueIndex("uq_reminder").on(t.kind, t.refKey)],
);
