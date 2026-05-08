import * as Sentry from "@sentry/node";

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    console.warn("[sentry] SENTRY_DSN not set — error tracking disabled");
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
    beforeSend(event) {
      if (event.user) {
        delete event.user.ip_address;
        delete event.user.username;
      }
      return event;
    },
  });
}

export { Sentry };
