import type { Redis } from "ioredis";

/**
 * RoboRebut Rebuttal Cache
 * Caches LLM responses in Redis to avoid repeat LLM calls for
 * identical objections. TTL: 24 hours.
 *
 * Cache key is based on:
 * - normalized objection text (lowercased, trimmed, collapsed whitespace)
 * - product vertical (mca, loc, sba, term, equipment, factoring — or "general")
 * - reply mode (live, precall)
 * - plan type (to respect tier differences in responses)
 */

const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const CACHE_PREFIX = "rebuttal:v1:";

export interface CacheKeyParams {
  objection: string;
  vertical?: string;
  replyMode?: string;
  planType?: string;
}

export interface CachedRebuttal {
  text: string;
  cachedAt: string;
  hitCount?: number;
}

/**
 * Normalize the objection text so minor variations hit the same cache entry.
 * "Your rates are too high!" and "your rates are too high" → same key
 */
function normalizeObjection(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "") // strip punctuation
    .replace(/\s+/g, " ")    // collapse whitespace
    .substring(0, 200);      // cap key length
}

export function buildCacheKey(params: CacheKeyParams): string {
  const normalized = normalizeObjection(params.objection);
  const vertical = (params.vertical ?? "general").toLowerCase();
  const mode = (params.replyMode ?? "live").toLowerCase();
  const plan = (params.planType ?? "free").toLowerCase();
  return `${CACHE_PREFIX}${vertical}:${mode}:${plan}:${normalized}`;
}

/**
 * Try to get a cached rebuttal. Returns null on miss or Redis error.
 */
export async function getCachedRebuttal(
  redis: Redis,
  params: CacheKeyParams
): Promise<CachedRebuttal | null> {
  try {
    const key = buildCacheKey(params);
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as CachedRebuttal;
  } catch {
    // Never let cache errors break the request — just miss
    return null;
  }
}

/**
 * Store a rebuttal in Redis. Fire-and-forget — never awaited on hot path.
 */
export async function setCachedRebuttal(
  redis: Redis,
  params: CacheKeyParams,
  text: string
): Promise<void> {
  try {
    const key = buildCacheKey(params);
    const value: CachedRebuttal = {
      text,
      cachedAt: new Date().toISOString(),
    };
    await redis.set(key, JSON.stringify(value), "EX", CACHE_TTL_SECONDS);
  } catch {
    // Never let cache errors break the request
  }
}

/**
 * Invalidate a single cache entry. Use when a broker marks a response
 * as unhelpful so they don't keep getting the bad cached version.
 */
export async function invalidateCachedRebuttal(
  redis: Redis,
  params: CacheKeyParams
): Promise<void> {
  try {
    const key = buildCacheKey(params);
    await redis.del(key);
  } catch {
    // Swallow
  }
}
