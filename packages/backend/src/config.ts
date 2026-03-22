function env(key: string): string {
  const v = process.env[key];
  if (v === undefined || v === "") throw new Error(`Missing env: ${key}`);
  return v;
}

function envOptional(key: string): string | undefined {
  return process.env[key];
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.BACKEND_PORT || process.env.PORT || 4001),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3001",
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
