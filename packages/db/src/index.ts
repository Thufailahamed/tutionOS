import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export * from "./schema";
export { schema };

export type Database = ReturnType<typeof createDb>;

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export { sql, eq, and, or, desc, asc, lt, gt, gte, lte, ne, inArray, isNull, isNotNull, like, count, sum } from "drizzle-orm";
