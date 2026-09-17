export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  KV: KVNamespace;
  NOTIFICATIONS_QUEUE?: Queue;
  JOBS_QUEUE?: Queue;
  AI?: Ai;
  ASSETS?: Fetcher;
  APP_NAME?: string;
  BRAND_TAGLINE?: string;
  ENVIRONMENT?: string;
  SESSION_SECRET?: string;
  SMS_PROVIDER?: string;
  SMS_API_KEY?: string;
  SMS_SENDER_ID?: string;
  SMS_API_URL?: string;
  EMAIL_PROVIDER?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_API_URL?: string;
  WHATSAPP_PROVIDER?: string;
  WHATSAPP_API_KEY?: string;
  WHATSAPP_API_URL?: string;
}
