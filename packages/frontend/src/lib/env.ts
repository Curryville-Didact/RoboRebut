import { readNextPublicString } from "@/lib/publicEnv";

/**
 * Single source of truth for backend URLs (HTTP + WebSocket).
 * Defaults match local dev: backend on 3001, same host for WS.
 */

const trimSlash = (s: string) => s.replace(/\/$/, "");

/**
 * Dev-only: Next may expose `NEXT_PUBLIC_API_URL` as `http://localhost:3001` on the server while the
 * client bundle inlines a different loopback form, causing hydration mismatches on absolute URLs.
 * Normalize `localhost` → `127.0.0.1` so SSR and client render identical `href`s.
 */
function canonicalizeBackendHttpUrl(url: string): string {
  const trimmed = trimSlash(url);
  try {
    const u = new URL(trimmed);
    if (u.hostname === "localhost") {
      u.hostname = "127.0.0.1";
    }
    return trimSlash(u.toString());
  } catch {
    return trimmed;
  }
}

/** e.g. http://127.0.0.1:3001 */
export const API_URL = canonicalizeBackendHttpUrl(
  readNextPublicString("NEXT_PUBLIC_API_URL", "http://127.0.0.1:3001")
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
const wsOverride = readNextPublicString("NEXT_PUBLIC_WS_URL", "");
export const WS_URL =
  wsOverride !== ""
    ? trimSlash(wsOverride)
    : `${httpBaseToWsBase(API_URL)}/ws`;
