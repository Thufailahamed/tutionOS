/**
 * Applies SQL migrations (one file, statements split on `--> statement-breakpoint`)
 * directly to a D1Database. Used by tests and the dev seed CLI; production/local
 * dev applies the same files via `wrangler d1 migrations apply`.
 */
export async function applyMigrations(d1: D1Database, files: { name: string; sql: string }[]) {
  for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
    const statements = f.sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await d1.exec(stmt);
    }
  }
}
