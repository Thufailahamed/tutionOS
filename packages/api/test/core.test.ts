import { describe, it, expect } from "vitest";
import {
  normalizeLKPhone,
  isValidLKPhone,
  formatLKPhone,
  centsToDisplay,
  displayToCents,
  effectivePermissions,
  hasPermission,
  rolePermissions,
  PERMISSIONS,
  csvStudentRowSchema,
  studentSchema,
  registerSchema,
  aiQuestionRequestSchema,
} from "@classflow/core";
import { gradeFor, competitionRanks } from "../src/routes/exams";

describe("normalizeLKPhone", () => {
  it("normalizes local, international and formatted variants", () => {
    expect(normalizeLKPhone("0771234567")).toBe("+94771234567");
    expect(normalizeLKPhone("771234567")).toBe("+94771234567");
    expect(normalizeLKPhone("+94771234567")).toBe("+94771234567");
    expect(normalizeLKPhone("94771234567")).toBe("+94771234567");
    expect(normalizeLKPhone("0094771234567")).toBe("+94771234567");
    expect(normalizeLKPhone("+94 77 123 4567")).toBe("+94771234567");
    expect(normalizeLKPhone("077-123-4567")).toBe("+94771234567");
  });
  it("rejects malformed numbers", () => {
    expect(normalizeLKPhone("123")).toBeNull();
    expect(normalizeLKPhone("")).toBeNull();
    expect(normalizeLKPhone(null)).toBeNull();
    expect(normalizeLKPhone("07712345678")).toBeNull();
    expect(isValidLKPhone("abc")).toBe(false);
  });
  it("formats E.164 for display", () => {
    expect(formatLKPhone("+94771234567")).toBe("+94 77 123 4567");
    expect(formatLKPhone("")).toBe("");
  });
});

describe("money", () => {
  it("formats cents to display", () => {
    expect(centsToDisplay(250000)).toBe("Rs. 2,500");
    expect(centsToDisplay(250050)).toBe("Rs. 2,500.50");
    expect(centsToDisplay(99)).toBe("Rs. 0.99");
  });
  it("parses display input to integer cents", () => {
    expect(displayToCents("2500")).toBe(250000);
    expect(displayToCents("Rs. 1,234.56")).toBe(123456);
    expect(displayToCents(59.9)).toBe(5990);
    expect(displayToCents("junk")).toBe(0);
  });
});

describe("permissions", () => {
  it("owner has the full catalog", () => {
    expect(rolePermissions("owner").length).toBe(PERMISSIONS.length);
  });
  it("grants add and revokes remove", () => {
    const set = effectivePermissions("teacher", ["billing.manage"], ["payments.record"]);
    expect(hasPermission(set, "billing.manage")).toBe(true);
    expect(hasPermission(set, "payments.record")).toBe(false);
  });
  it("staff is a restricted role", () => {
    const set = effectivePermissions("staff");
    expect(hasPermission(set, "students.view")).toBe(true);
    expect(hasPermission(set, "billing.manage")).toBe(false);
    expect(hasPermission(set, "settings.manage")).toBe(false);
  });
});

describe("schemas", () => {
  it("csvStudentRowSchema accepts the documented columns", () => {
    const row = csvStudentRowSchema.parse({ name: "Nimal", phone: "0771234567", grade: "11", class: "Maths", guardian: "Sunil", guardianPhone: "0712345678" });
    expect(row.name).toBe("Nimal");
  });
  it("studentSchema requires a name", () => {
    expect(studentSchema.safeParse({ fullName: "" }).success).toBe(false);
    expect(studentSchema.safeParse({ fullName: "Amaya Perera" }).success).toBe(true);
  });
  it("registerSchema requires email or phone", () => {
    expect(registerSchema.safeParse({ fullName: "A B", password: "password123" }).success).toBe(false);
    expect(registerSchema.safeParse({ fullName: "A B", password: "password123", email: "a@b.lk" }).success).toBe(true);
  });
  it("aiQuestionRequestSchema applies defaults", () => {
    const r = aiQuestionRequestSchema.parse({ subject: "Maths", grade: "11", topic: "Algebra" });
    expect(r.count).toBe(10);
    expect(r.difficulty).toBe("medium");
    expect(r.questionType).toBe("mcq");
  });
});

describe("gradeFor", () => {
  it("maps percentages to default bands", () => {
    expect(gradeFor(8000)).toBe("A");
    expect(gradeFor(7500)).toBe("A");
    expect(gradeFor(6600)).toBe("B");
    expect(gradeFor(5000)).toBe("C");
    expect(gradeFor(3500)).toBe("S");
    expect(gradeFor(1000)).toBe("F");
  });
  it("honors custom grading schemes and falls back on bad JSON", () => {
    const scheme = JSON.stringify([{ min: 90, grade: "A+" }, { min: 50, grade: "P" }, { min: 0, grade: "F" }]);
    expect(gradeFor(9500, scheme)).toBe("A+");
    expect(gradeFor(6000, scheme)).toBe("P");
    expect(gradeFor(8000, "not-json")).toBe("A");
  });
});

describe("competitionRanks", () => {
  it("shares rank on ties and skips the next rank", () => {
    expect(competitionRanks([90, 85, 85, 70])).toEqual([1, 2, 2, 4]);
    expect(competitionRanks([100, 100, 100])).toEqual([1, 1, 1]);
    expect(competitionRanks([90, 80, 70])).toEqual([1, 2, 3]);
    expect(competitionRanks([80, 80, 80, 70, 70])).toEqual([1, 1, 1, 4, 4]);
  });
});
