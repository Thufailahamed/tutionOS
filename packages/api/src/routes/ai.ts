import { Hono } from "hono";
import { eq, and, sql, desc, gte } from "drizzle-orm";
import { z } from "zod";
import {
  aiGenerations,
  aiUsage,
  students,
  studentFees,
  examResults,
  exams,
  classes,
  attendanceRecords,
  classSessions,
  subscriptions,
  subscriptionPlans,
  classEnrollments,
  type Database,
} from "@classflow/db";
import { aiQuestionRequestSchema } from "@classflow/core";
import type { Env } from "../env";
import type { ApiVariables } from "../middleware/session";
import { requireAuth, requirePerm } from "../middleware/guard";
import { ok, notFound, badRequest, nowIso } from "../lib/http";
import { audit } from "../lib/audit";
import { uuid } from "../lib/crypto";

export const aiRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

aiRoutes.use("*", requireAuth, requirePerm("ai.use"));

// ---------- Provider abstraction ----------

interface AiProvider {
  name: string;
  available(): boolean;
  generate(prompt: string, env: Env): Promise<string>;
}

const workersAiProvider: AiProvider = {
  name: "workers-ai",
  available() {
    return true;
  },
  async generate(prompt, env) {
    const res = await env.AI!.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast" as never, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4096,
    } as never);
    const text = (res as { response?: string }).response ?? JSON.stringify(res);
    return text;
  },
};

const fallbackProvider: AiProvider = {
  name: "template",
  available() {
    return true;
  },
  async generate() {
    return "";
  },
};

function pickProvider(env: Env): AiProvider {
  if (env.AI) return workersAiProvider;
  return fallbackProvider;
}

async function checkAiBudget(db: Database, orgId: string): Promise<{ allowed: boolean; used: number; limit: number }> {
  const rows = await db
    .select({ credits: subscriptionPlans.aiCreditsMonthly })
    .from(subscriptions)
    .innerJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
    .where(and(eq(subscriptions.orgId, orgId), eq(subscriptions.status, "active")))
    .limit(1);
  const limit = rows[0]?.credits ?? 0;
  const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
  const usage = await db
    .select({ n: sql<number>`coalesce(sum(${aiUsage.units}),0)` })
    .from(aiUsage)
    .where(and(eq(aiUsage.orgId, orgId), gte(aiUsage.createdAt, monthStart)));
  const used = usage[0]?.n ?? 0;
  return { allowed: limit > 0 ? used < limit : true, used, limit };
}

async function trackUsage(db: Database, orgId: string, kind: string, model: string | null, units = 1) {
  await db.insert(aiUsage).values({ id: uuid(), orgId, kind, units, model, createdAt: nowIso() });
}

// ---------- Question generation ----------

function buildQuestionPrompt(input: z.infer<typeof aiQuestionRequestSchema>): string {
  const typeNames: Record<string, string> = {
    mcq: "multiple-choice questions with exactly 4 options",
    short_answer: "short-answer questions",
    structured: "structured questions with sub-parts",
    essay: "essay questions",
    true_false: "true/false questions",
  };
  return `You are an expert Sri Lankan ${input.subject} teacher writing exam questions for ${input.grade} students.

Generate ${input.count} ${typeNames[input.questionType]} on the topic "${input.topic}" at ${input.difficulty} difficulty, in ${input.language}.

Return ONLY a JSON array. Each element must have:
- "question": string
- "options": string[] (MCQ only, otherwise empty array)
- "correctAnswer": string (or option index for MCQ)
- "explanation": string
- "difficulty": "easy"|"medium"|"hard"
- "topic": string
- "learningObjective": string

Do not include markdown fences or prose — only the JSON array.`;
}

/** Deterministic local generator used when Workers AI isn't bound (dev). */
function generateLocalQuestions(input: z.infer<typeof aiQuestionRequestSchema>) {
  const out = [];
  for (let i = 0; i < input.count; i++) {
    if (input.questionType === "mcq") {
      out.push({
        question: `[${input.subject} — ${input.topic}] Question ${i + 1}: Which statement about ${input.topic} is correct?`,
        options: [
          `Option A — definition of ${input.topic}`,
          `Option B — incorrect claim about ${input.topic}`,
          `Option C — unrelated concept`,
          `Option D — partially correct statement`,
        ],
        correctAnswer: "0",
        explanation: `This tests understanding of ${input.topic} for ${input.grade} level.`,
        difficulty: input.difficulty,
        topic: input.topic,
        learningObjective: `Recall and apply ${input.topic} concepts`,
      });
    } else if (input.questionType === "true_false") {
      out.push({
        question: `[${input.subject} — ${input.topic}] Statement ${i + 1}: True or false?`,
        options: ["True", "False"],
        correctAnswer: "True",
        explanation: `Tests ${input.topic} fundamentals.`,
        difficulty: input.difficulty,
        topic: input.topic,
        learningObjective: `Evaluate statements about ${input.topic}`,
      });
    } else {
      out.push({
        question: `[${input.subject} — ${input.topic}] Question ${i + 1}: Explain a key concept in ${input.topic} with an example.`,
        options: [],
        correctAnswer: "See marking scheme",
        explanation: `Assesses depth of understanding of ${input.topic}.`,
        difficulty: input.difficulty,
        topic: input.topic,
        learningObjective: `Explain ${input.topic} in own words`,
      });
    }
  }
  return out;
}

aiRoutes.post("/questions/generate", async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const input = aiQuestionRequestSchema.parse(await c.req.json());
  const budget = await checkAiBudget(db, member.orgId);
  if (!budget.allowed) {
    return badRequest(`AI credit limit reached (${budget.used}/${budget.limit}). Upgrade your plan for more.`);
  }
  const provider = pickProvider(c.env);
  let questions: unknown[] = [];
  let model: string | null = null;
  let error: string | null = null;
  if (provider === workersAiProvider) {
    model = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
    try {
      const raw = await provider.generate(buildQuestionPrompt(input), c.env);
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const start = cleaned.indexOf("[");
      const end = cleaned.lastIndexOf("]");
      questions = JSON.parse(cleaned.slice(start, end + 1));
      if (!Array.isArray(questions)) questions = [];
    } catch (e) {
      error = `AI generation failed: ${String(e).slice(0, 200)}`;
      questions = generateLocalQuestions(input);
    }
  } else {
    questions = generateLocalQuestions(input);
    model = "template-fallback";
  }
  const id = uuid();
  const now = nowIso();
  await db.insert(aiGenerations).values({
    id,
    orgId: member.orgId,
    kind: "questions",
    status: "draft",
    inputJson: JSON.stringify(input),
    outputJson: JSON.stringify(questions),
    model,
    error,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  });
  await trackUsage(db, member.orgId, "questions", model);
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: "AI_QUESTIONS_GENERATED", entity: "ai_generation", entityId: id, metadata: { count: questions.length, model } });
  return ok({ id, questions, model, budget: { used: budget.used + 1, limit: budget.limit } });
});

aiRoutes.get("/generations", async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const rows = await db
    .select()
    .from(aiGenerations)
    .where(eq(aiGenerations.orgId, member.orgId))
    .orderBy(desc(aiGenerations.createdAt))
    .limit(50);
  return ok(rows.map((r) => ({ ...r, input: JSON.parse(r.inputJson), output: JSON.parse(r.outputJson) })));
});

aiRoutes.get("/generations/:id", async (c) => {
  const member = c.get("member")!;
  const rows = await c.get("db").select().from(aiGenerations).where(and(eq(aiGenerations.id, c.req.param("id")), eq(aiGenerations.orgId, member.orgId))).limit(1);
  if (!rows[0]) return notFound();
  return ok({ ...rows[0], input: JSON.parse(rows[0].inputJson), output: JSON.parse(rows[0].outputJson) });
});

aiRoutes.post("/generations/:id/review", async (c) => {
  const member = c.get("member")!;
  const user = c.get("user")!;
  const db = c.get("db");
  const body = z
    .object({
      action: z.enum(["approve", "reject", "publish", "edit"]),
      output: z.array(z.record(z.string(), z.unknown())).optional(),
    })
    .parse(await c.req.json());
  const rows = await db.select().from(aiGenerations).where(and(eq(aiGenerations.id, c.req.param("id")), eq(aiGenerations.orgId, member.orgId))).limit(1);
  if (!rows[0]) return notFound();
  const status = body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : body.action === "publish" ? "published" : rows[0].status;
  const patch: Record<string, unknown> = { status, updatedAt: nowIso() };
  if (body.output) patch.outputJson = JSON.stringify(body.output);
  await db.update(aiGenerations).set(patch).where(eq(aiGenerations.id, rows[0].id));
  await audit(db, { orgId: member.orgId, actorUserId: user.id, action: `AI_GENERATION_${body.action.toUpperCase()}`, entity: "ai_generation", entityId: rows[0].id });
  return ok({ status });
});

// ---------- Teacher-facing insights (grounded in real data) ----------

aiRoutes.get("/insights", async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const orgId = member.orgId;
  const insights: { kind: string; severity: "info" | "warning"; text: string }[] = [];

  // 1) latest exam underperformers
  const latestExam = await db.select().from(exams).where(and(eq(exams.orgId, orgId), eq(exams.status, "published"))).orderBy(desc(exams.date)).limit(1);
  if (latestExam[0]) {
    const ex = latestExam[0];
    const below = await db
      .select({ n: sql<number>`count(*)` })
      .from(examResults)
      .where(and(eq(examResults.examId, ex.id), sql`${examResults.percentage} < 5000`));
    if ((below[0]?.n ?? 0) > 0) {
      insights.push({ kind: "exam", severity: "warning", text: `${below[0]!.n} students scored below 50% in "${ex.title}".` });
    }
    const avg = await db.select({ a: sql<number>`avg(${examResults.percentage})` }).from(examResults).where(eq(examResults.examId, ex.id));
    // previous exam in same class
    const prev = await db
      .select({ id: exams.id })
      .from(exams)
      .where(and(eq(exams.orgId, orgId), eq(exams.classId, ex.classId), sql`${exams.date} < ${ex.date}`, eq(exams.status, "published")))
      .orderBy(desc(exams.date))
      .limit(1);
    if (prev[0]) {
      const prevAvg = await db.select({ a: sql<number>`avg(${examResults.percentage})` }).from(examResults).where(eq(examResults.examId, prev[0].id));
      if (avg[0]?.a != null && prevAvg[0]?.a != null) {
        const diff = Math.round((avg[0].a - prevAvg[0].a) / 100);
        if (diff !== 0) {
          insights.push({
            kind: "exam",
            severity: diff < 0 ? "warning" : "info",
            text: `Class average ${diff > 0 ? "improved" : "dropped"} by ${Math.abs(diff)}% compared with the previous test.`,
          });
        }
      }
    }
  }

  // 2) declining attendance (students with 3+ consecutive absences in last 30d)
  const since = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
  const recent = await db
    .select({ studentId: attendanceRecords.studentId, status: attendanceRecords.status, date: classSessions.date })
    .from(attendanceRecords)
    .innerJoin(classSessions, eq(attendanceRecords.sessionId, classSessions.id))
    .where(and(eq(attendanceRecords.orgId, orgId), gte(classSessions.date, since)))
    .orderBy(attendanceRecords.studentId, desc(classSessions.date));
  const byStudent = new Map<string, string[]>();
  for (const r of recent) {
    const arr = byStudent.get(r.studentId) ?? [];
    arr.push(r.status);
    byStudent.set(r.studentId, arr);
  }
  let declining = 0;
  for (const statuses of byStudent.values()) {
    if (statuses.length >= 3 && statuses.slice(0, 3).every((s) => s === "absent")) declining++;
  }
  if (declining > 0) {
    insights.push({ kind: "attendance", severity: "warning", text: `${declining} students have missed 3 or more consecutive classes.` });
  }

  // 3) outstanding fees snapshot
  const out = await db
    .select({ n: sql<number>`count(distinct ${studentFees.studentId})`, total: sql<number>`coalesce(sum(${studentFees.amountCents} - ${studentFees.discountCents} - ${studentFees.paidCents}),0)` })
    .from(studentFees)
    .where(and(eq(studentFees.orgId, orgId), sql`${studentFees.status} in ('pending','partial','overdue')`));
  if ((out[0]?.n ?? 0) > 0) {
    insights.push({ kind: "fees", severity: "info", text: `${out[0]!.n} students have outstanding fees totalling Rs. ${((out[0]!.total ?? 0) / 100).toLocaleString()}.` });
  }

  return ok({ insights, generatedAt: nowIso() });
});

// ---------- Teacher assistant — structured tools only, never raw SQL ----------

aiRoutes.post("/assistant", async (c) => {
  const member = c.get("member")!;
  const db = c.get("db");
  const body = z.object({ question: z.string().min(3).max(1000) }).parse(await c.req.json());
  const q = body.question.toLowerCase();
  const orgId = member.orgId;

  // Tool dispatch — each tool returns authorized, structured data only
  let toolResult: { tool: string; data: unknown } | null = null;
  if (/unpaid|outstanding|haven'?t paid|fee/.test(q)) {
    const rows = await db
      .select({ studentId: studentFees.studentId, name: students.fullName, studentNo: students.studentNo, outstanding: sql<number>`sum(${studentFees.amountCents} - ${studentFees.discountCents} - ${studentFees.paidCents})` })
      .from(studentFees)
      .innerJoin(students, eq(studentFees.studentId, students.id))
      .where(and(eq(studentFees.orgId, orgId), sql`${studentFees.status} in ('pending','partial','overdue')`))
      .groupBy(studentFees.studentId)
      .limit(50);
    toolResult = { tool: "unpaid_students", data: rows };
  } else if (/missed|absent|consecutive|attendance/.test(q)) {
    const since = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
    const rows = await db
      .select({ studentId: attendanceRecords.studentId, name: students.fullName, absences: sql<number>`sum(case when ${attendanceRecords.status}='absent' then 1 else 0 end)`, total: sql<number>`count(*)` })
      .from(attendanceRecords)
      .innerJoin(students, eq(attendanceRecords.studentId, students.id))
      .innerJoin(classSessions, eq(attendanceRecords.sessionId, classSessions.id))
      .where(and(eq(attendanceRecords.orgId, orgId), gte(classSessions.date, since)))
      .groupBy(attendanceRecords.studentId)
      .orderBy(desc(sql`sum(case when ${attendanceRecords.status}='absent' then 1 else 0 end)`))
      .limit(20);
    toolResult = { tool: "attendance_summary", data: rows };
  } else if (/performance|average|summar|result/.test(q)) {
    const rows = await db
      .select({ title: exams.title, date: exams.date, n: sql<number>`count(${examResults.id})`, avg: sql<number>`avg(${examResults.percentage})` })
      .from(examResults)
      .innerJoin(exams, eq(examResults.examId, exams.id))
      .where(eq(examResults.orgId, orgId))
      .groupBy(exams.id)
      .orderBy(desc(exams.date))
      .limit(10);
    toolResult = { tool: "exam_summary", data: rows };
  } else if (/enroll|students|how many/.test(q)) {
    const rows = await db
      .select({ className: classes.name, n: sql<number>`count(case when ${classEnrollments.status}='active' then 1 end)` })
      .from(classEnrollments)
      .innerJoin(classes, eq(classEnrollments.classId, classes.id))
      .where(eq(classEnrollments.orgId, orgId))
      .groupBy(classes.id);
    toolResult = { tool: "enrollment_summary", data: rows };
  }

  if (!toolResult) {
    return ok({
      answer: "I can help with questions about unpaid fees, attendance patterns, exam performance, and enrollment. Try: \"Which students haven't paid this month?\"",
      tool: null,
      data: null,
    });
  }

  // Summarize grounded data — LLM optional
  let answer: string;
  const provider = pickProvider(c.env);
  if (provider === workersAiProvider) {
    try {
      const raw = await provider.generate(
        `You are an assistant for a tuition class teacher. Summarize this data concisely for their question: "${body.question}". Use only the data provided. Data (JSON): ${JSON.stringify(toolResult.data).slice(0, 3000)}`,
        c.env,
      );
      answer = raw.trim();
      await trackUsage(db, orgId, "assistant", "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    } catch {
      answer = templateSummary(toolResult.tool, toolResult.data);
    }
  } else {
    answer = templateSummary(toolResult.tool, toolResult.data);
  }
  return ok({ answer, tool: toolResult.tool, data: toolResult.data });
});

function templateSummary(tool: string, data: unknown): string {
  const rows = data as { name?: string; studentName?: string; outstanding?: number; absences?: number; avg?: number; title?: string; n?: number }[];
  if (tool === "unpaid_students") {
    if (!rows.length) return "All students are paid up.";
    const list = rows.slice(0, 10).map((r) => `${r.name} (Rs. ${((r.outstanding ?? 0) / 100).toLocaleString()})`).join(", ");
    return `${rows.length} students have outstanding fees: ${list}${rows.length > 10 ? "…" : ""}`;
  }
  if (tool === "attendance_summary") {
    const worst = rows.filter((r) => (r.absences ?? 0) >= 3);
    if (!worst.length) return "No students with 3+ absences in the last 30 days.";
    return `${worst.length} students with frequent absences: ${worst.slice(0, 10).map((r) => `${r.name} (${r.absences})`).join(", ")}`;
  }
  if (tool === "exam_summary") {
    if (!rows.length) return "No exam results recorded yet.";
    return `Recent exams: ${rows.map((r) => `"${r.title}" avg ${Math.round((r.avg ?? 0) / 100)}%`).join("; ")}`;
  }
  if (tool === "enrollment_summary") {
    if (!rows.length) return "No enrollments yet.";
    return rows.map((r) => `${r.title ?? (r as { className?: string }).className}: ${r.n} students`).join("; ");
  }
  return "Here is the data I found.";
}
