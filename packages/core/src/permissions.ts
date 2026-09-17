/**
 * Granular RBAC permission catalog.
 * Every API route enforces these server-side; roles map to permission sets and
 * organization members can carry per-member overrides.
 */
export const PERMISSIONS = [
  "students.view",
  "students.create",
  "students.update",
  "students.delete",
  "students.import",
  "guardians.view",
  "guardians.manage",
  "classes.view",
  "classes.create",
  "classes.manage",
  "attendance.view",
  "attendance.record",
  "attendance.update",
  "payments.view",
  "payments.record",
  "payments.refund",
  "fees.manage",
  "exams.view",
  "exams.create",
  "exams.edit",
  "results.enter",
  "results.publish",
  "homework.view",
  "homework.manage",
  "homework.grade",
  "materials.view",
  "materials.manage",
  "lessons.view",
  "lessons.manage",
  "announcements.view",
  "announcements.manage",
  "messages.send",
  "notifications.manage",
  "reports.view",
  "certificates.manage",
  "ai.use",
  "settings.manage",
  "staff.manage",
  "billing.manage",
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ORG_ROLES = ["owner", "admin", "teacher", "staff"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

const ALL: readonly Permission[] = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  owner: ALL,
  admin: ALL.filter((p) => p !== "billing.manage"),
  teacher: [
    "students.view",
    "students.create",
    "students.update",
    "guardians.view",
    "guardians.manage",
    "classes.view",
    "classes.create",
    "classes.manage",
    "attendance.view",
    "attendance.record",
    "attendance.update",
    "payments.view",
    "payments.record",
    "exams.view",
    "exams.create",
    "exams.edit",
    "results.enter",
    "results.publish",
    "homework.view",
    "homework.manage",
    "homework.grade",
    "materials.view",
    "materials.manage",
    "lessons.view",
    "lessons.manage",
    "announcements.view",
    "announcements.manage",
    "messages.send",
    "reports.view",
    "certificates.manage",
    "ai.use",
  ],
  staff: [
    "students.view",
    "students.create",
    "students.update",
    "students.import",
    "guardians.view",
    "guardians.manage",
    "classes.view",
    "attendance.view",
    "attendance.record",
    "payments.view",
    "payments.record",
    "exams.view",
    "homework.view",
    "materials.view",
    "announcements.view",
    "notifications.manage",
    "reports.view",
  ],
};

export function rolePermissions(role: OrgRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/** Effective permissions = role set plus member-level grants minus revokes. */
export function effectivePermissions(
  role: OrgRole,
  grants: readonly string[] = [],
  revokes: readonly string[] = [],
): Set<string> {
  const set = new Set<string>(rolePermissions(role));
  for (const g of grants) set.add(g);
  for (const r of revokes) set.delete(r);
  return set;
}

export function hasPermission(set: Set<string>, perm: Permission): boolean {
  return set.has(perm);
}
