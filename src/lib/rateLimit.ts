import { getRedisConnection } from "@/queue";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

// In-memory fallback map for environments where Redis is not reachable
const localRateLimits = new Map<string, RateLimitRecord>();

// Periodic cleanup of stale in-memory entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  localRateLimits.forEach((record, key) => {
    if (record.resetAt <= now) {
      localRateLimits.delete(key);
    }
  });
}, 5 * 60 * 1000).unref();

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

/**
 * Checks and increments rate limit for a given key using Redis (if active)
 * or local in-memory sliding window fallback.
 *
 * @param key Unique identifier (e.g. `login:${ip}`, `audit:${userId}`)
 * @param limit Maximum allowed requests within the window
 * @param windowSeconds Window duration in seconds
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const rateLimitKey = `rl:${key}`;
  const now = Date.now();

  try {
    const redis = getRedisConnection();
    if (redis && redis.status === "ready") {
      // Redis atomic INCR + EXPIRE pipeline
      const current = await redis.incr(rateLimitKey);
      if (current === 1) {
        await redis.expire(rateLimitKey, windowSeconds);
      }
      const ttl = await redis.ttl(rateLimitKey);

      return {
        success: current <= limit,
        limit,
        remaining: Math.max(0, limit - current),
        resetSeconds: ttl > 0 ? ttl : windowSeconds,
      };
    }
  } catch {
    // Fall back to in-memory store if Redis encounters connection issues
  }

  // In-memory fallback
  const record = localRateLimits.get(rateLimitKey);

  if (!record || record.resetAt <= now) {
    localRateLimits.set(rateLimitKey, {
      count: 1,
      resetAt: now + windowSeconds * 1000,
    });
    return {
      success: true,
      limit,
      remaining: limit - 1,
      resetSeconds: windowSeconds,
    };
  }

  record.count += 1;
  const remaining = Math.max(0, limit - record.count);
  const resetSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));

  return {
    success: record.count <= limit,
    limit,
    remaining,
    resetSeconds,
  };
}

/**
 * Convenience helper to extract client IP from Next.js request headers
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "127.0.0.1";
}
