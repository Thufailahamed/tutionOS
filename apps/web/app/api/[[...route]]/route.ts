import { env } from "cloudflare:workers";
import { createApiApp } from "@classflow/api";
import type { Env } from "@classflow/api";

const api = createApiApp();

const ctx = {
  waitUntil: (p: Promise<unknown>) => {
    void p;
  },
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

async function handler(req: Request): Promise<Response> {
  return api.fetch(req, env as unknown as Env, ctx);
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as OPTIONS };
