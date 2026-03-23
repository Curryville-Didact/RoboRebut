/**
 * Single source of truth for backend URLs (HTTP + WebSocket).
 * Defaults match local dev: backend on 3001, same host for WS.
 */

const trimSlash = (s: string) => s.replace(/\/$/, "");

/** e.g. http://127.0.0.1:3001 */
export const API_URL = trimSlash(
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3001"
);

function httpBaseToWsBase(httpUrl: string): string {
  if (httpUrl.startsWith("https://")) {
    return `wss://${httpUrl.slice("https://".length)}`;
  }
  if (httpUrl.startsWith("http://")) {
    return `ws://${httpUrl.slice("http://".length)}`;
  }
  return httpUrl;
}

/**
 * Full WebSocket URL including path (Fastify serves `/ws`).
 * Override with NEXT_PUBLIC_WS_URL if needed.
 */
export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? `${httpBaseToWsBase(API_URL)}/ws`;
