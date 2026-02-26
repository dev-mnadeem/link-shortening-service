import { createRateLimitError } from "../utils/errors.js";

/**
 * Fixed-window, per-client rate limiter.
 *
 * Two deliberate departures from the naive version:
 *
 * 1. It is a factory, not a module-level singleton. The original installed a
 *    `setInterval` at import time, which no caller could ever stop - a leaked
 *    timer in tests and a shared bucket map across every app instance.
 * 2. The bucket map is bounded. An attacker cycling source addresses (trivial
 *    when `X-Forwarded-For` is trusted) would otherwise grow it without limit
 *    between sweeps, turning the rate limiter itself into the memory
 *    exhaustion vector.
 */
export const createRateLimiter = ({
  maxRequests,
  windowMs,
  cleanupIntervalMs = 60_000,
  maxTrackedClients = 100_000,
  now = Date.now,
  keyFor = (req) => req.ip || req.socket?.remoteAddress || "unknown-client",
}) => {
  const buckets = new Map();
  let cleanupTimer = null;

  const sweep = () => {
    const timestamp = now();

    for (const [key, bucket] of buckets) {
      if (timestamp >= bucket.resetAt) {
        buckets.delete(key);
      }
    }
  };

  const evictOldestIfFull = () => {
    if (buckets.size < maxTrackedClients) {
      return;
    }

    sweep();

    while (buckets.size >= maxTrackedClients) {
      const oldestKey = buckets.keys().next().value;

      if (oldestKey === undefined) {
        return;
      }

      buckets.delete(oldestKey);
    }
  };

  const middleware = (req, res, next) => {
    const timestamp = now();
    const clientKey = keyFor(req);
    const bucket = buckets.get(clientKey);

    if (!bucket || timestamp >= bucket.resetAt) {
      evictOldestIfFull();
      buckets.set(clientKey, { count: 1, resetAt: timestamp + windowMs });
      setRateLimitHeaders(res, maxRequests, maxRequests - 1, timestamp + windowMs);
      next();
      return;
    }

    if (bucket.count >= maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000));

      setRateLimitHeaders(res, maxRequests, 0, bucket.resetAt);
      res.set("Retry-After", String(retryAfterSeconds));

      next(
        createRateLimitError("Rate limit exceeded.", {
          retryAfterSeconds,
          limit: maxRequests,
          windowMs,
        }),
      );
      return;
    }

    bucket.count += 1;
    setRateLimitHeaders(res, maxRequests, maxRequests - bucket.count, bucket.resetAt);
    next();
  };

  return {
    middleware,

    start() {
      if (cleanupTimer === null && cleanupIntervalMs > 0) {
        cleanupTimer = setInterval(sweep, cleanupIntervalMs);
        cleanupTimer.unref?.();
      }
    },

    stop() {
      if (cleanupTimer !== null) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
      }
    },

    reset() {
      buckets.clear();
    },

    get size() {
      return buckets.size;
    },
  };
};

const setRateLimitHeaders = (res, limit, remaining, resetAt) => {
  res.set("RateLimit-Limit", String(limit));
  res.set("RateLimit-Remaining", String(Math.max(0, remaining)));
  res.set("RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
};
