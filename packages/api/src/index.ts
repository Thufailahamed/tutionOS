import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import type { Env } from "./env";
import type { ApiVariables } from "./middleware/session";
import { sessionMiddleware } from "./middleware/session";
import { securityHeaders } from "./middleware/security";
import { authRoutes } from "./routes/auth";
import { orgRoutes } from "./routes/organizations";
import { studentRoutes } from "./routes/students";
import { classRoutes } from "./routes/classes";
import { attendanceRoutes } from "./routes/attendance";
import { financeRoutes } from "./routes/finance";
import { examRoutes } from "./routes/exams";
import { homeworkRoutes } from "./routes/homework";
import { fileRoutes, materialRoutes, lessonRoutes } from "./routes/files";
import { commsRoutes } from "./routes/comms";
import { dashboardRoutes } from "./routes/dashboard";
import { billingRoutes, adminRoutes } from "./routes/billing";
import { aiRoutes } from "./routes/ai";
import { portalRoutes } from "./routes/portal";
import { teacherRoutes } from "./routes/teachers";
import { applyMigrations } from "@classflow/db/migrate";
import { bundledMigrations } from "@classflow/db/migrations_bundle";
import { ensureDefaultPlans } from "./services/auth";

export type { Env } from "./env";

export function createApiApp() {
  const api = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

  api.use("*", securityHeaders);
  api.use("*", sessionMiddleware);

  // One-shot self-heal for fresh databases (local dev + first deploy): apply
  // pending migrations and default plans before serving. Idempotent.
  api.use("*", async (c, next) => {
    const kv = c.env.KV;
    const flag = "migrations:applied:v1";
    let done = false;
    try {
      done = (await kv?.get(flag)) === "1";
    } catch {
      done = false;
    }
    if (!done) {
      try {
        await applyMigrations(c.env.DB, bundledMigrations);
        await ensureDefaultPlans(c.get("db"));
        try {
          await kv?.put(flag, "1");
        } catch {
          // kv unavailable — migrations are idempotent anyway
        }
      } catch (e) {
        // Migration error: surface as 500 with detail, do not serve stale API
        throw new HTTPException(500, { message: `Database migration failed: ${String(e)}` });
      }
    }
    return next();
  });

  api.get("/api/health", (c) => c.json({ ok: true, app: "classflow" }));

  api.route("/api/auth", authRoutes);
  api.route("/api/orgs", orgRoutes);
  api.route("/api/students", studentRoutes);
  api.route("/api/classes", classRoutes);
  api.route("/api/attendance", attendanceRoutes);
  api.route("/api/finance", financeRoutes);
  api.route("/api/exams", examRoutes);
  api.route("/api/homework", homeworkRoutes);
  api.route("/api/files", fileRoutes);
  api.route("/api/materials", materialRoutes);
  api.route("/api/lessons", lessonRoutes);
  api.route("/api/comms", commsRoutes);
  api.route("/api/dashboard", dashboardRoutes);
  api.route("/api/billing", billingRoutes);
  api.route("/api/admin", adminRoutes);
  api.route("/api/ai", aiRoutes);
  api.route("/api/portal", portalRoutes);
  api.route("/api/teachers", teacherRoutes);

  api.onError((err, c) => {
    if (err instanceof HTTPException) {
      return err.getResponse();
    }
    if (err instanceof ZodError) {
      return c.json(
        { ok: false, error: { code: "VALIDATION", message: err.issues[0]?.message ?? "Invalid input", details: err.issues } },
        400,
      );
    }
    console.error("API error:", err);
    return c.json({ ok: false, error: "Internal server error" }, 500);
  });

  api.notFound((c) => c.json({ ok: false, error: "Not found" }, 404));

  return api;
}
