function env(key: string): string {
  const v = process.env[key];
  if (v === undefined || v === "") throw new Error(`Missing env: ${key}`);
  return v;
}

function envOptional(key: string): string | undefined {
  return process.env[key];
}

/** Common local dev ports (localhost + 127.0.0.1) for CORS + WebSocket Origin checks */
const DEFAULT_LOCAL_DEV_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3003",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3002",
  "http://127.0.0.1:3003",
];

/**
 * Origins allowed for @fastify/cors and WebSocket `verifyClient`.
 * Set `CORS_ORIGINS` to a comma-separated list to override completely.
 * Otherwise: FRONTEND_URL plus common localhost dev URLs (deduped).
 */
function corsAllowedOrigins(): string[] {
  const explicit = envOptional("CORS_ORIGINS");
  if (explicit) {
    return explicit
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const primary = envOptional("FRONTEND_URL") ?? "http://localhost:3000";
  return Array.from(new Set([primary, ...DEFAULT_LOCAL_DEV_ORIGINS]));
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.BACKEND_PORT || process.env.PORT || 3001),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  corsAllowedOrigins: corsAllowedOrigins(),
  databaseUrl: env("DATABASE_URL"),
  redisUrl: env("REDIS_URL"),

  clerkSecretKey: envOptional("CLERK_SECRET_KEY"),
  clerkPublishableKey: envOptional("CLERK_PUBLISHABLE_KEY"),

  openaiApiKey: envOptional("OPENAI_API_KEY"),
  deepgramApiKey: envOptional("DEEPGRAM_API_KEY"),
  twilioAccountSid: envOptional("TWILIO_ACCOUNT_SID"),
  twilioAuthToken: envOptional("TWILIO_AUTH_TOKEN"),
} as const;

export type Config = typeof config;
