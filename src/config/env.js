import dotenv from "dotenv";
import { parseBoolean, parseInteger } from "../utils/number.js";
import { DEFAULT_CODE_LENGTH } from "../utils/shortCode.js";

dotenv.config({ quiet: true });

const IP_MODES = new Set(["full", "anonymized", "none"]);
const STORAGE_DRIVERS = new Set(["mysql", "memory"]);

const pickFrom = (allowed, value, fallback) =>
  allowed.has(String(value ?? "").toLowerCase()) ? String(value).toLowerCase() : fallback;

/**
 * Reads configuration once, from an explicit source object, and returns a
 * frozen tree. Taking `env` as an argument (rather than reading
 * `process.env` at each use site) is what makes configuration testable.
 */
export const loadConfig = (env = process.env) => {
  const config = {
    app: {
      env: env.NODE_ENV || "development",
      port: parseInteger(env.PORT, 3000, { allowZero: true }),
      baseUrl: (env.BASE_URL || "http://localhost:3000").replace(/\/+$/, ""),
      // Off by default: with `trust proxy` on, any client can set
      // X-Forwarded-For and walk straight past IP rate limiting. Turn it on
      // only when a proxy you control is guaranteed to rewrite the header.
      trustProxy: parseBoolean(env.TRUST_PROXY, false),
      logLevel: env.LOG_LEVEL || "info",
      shutdownTimeoutMs: parseInteger(env.SHUTDOWN_TIMEOUT_MS, 10_000),
    },
    storage: {
      driver: pickFrom(STORAGE_DRIVERS, env.STORAGE_DRIVER, "mysql"),
    },
    db: {
      host: env.DB_HOST || "127.0.0.1",
      port: parseInteger(env.DB_PORT, 3306),
      user: env.DB_USER || "root",
      password: env.DB_PASSWORD || "",
      database: env.DB_NAME || "url_shortener",
      connectionLimit: parseInteger(env.DB_POOL_SIZE, 10),
    },
    shortCode: {
      length: parseInteger(env.SHORT_CODE_LENGTH, DEFAULT_CODE_LENGTH),
      maxGenerationAttempts: parseInteger(env.SHORT_CODE_MAX_ATTEMPTS, 5),
    },
    cache: {
      maxSize: parseInteger(env.CACHE_MAX_ENTRIES, 10_000),
      ttlMs: parseInteger(env.CACHE_TTL_MS, 300_000),
      // Short-lived negative caching so an enumeration scan of unknown codes
      // cannot turn into one database round trip per guess.
      missTtlMs: parseInteger(env.CACHE_MISS_TTL_MS, 5_000),
    },
    clicks: {
      ipMode: pickFrom(IP_MODES, env.CLICK_IP_MODE, "full"),
      batchSize: parseInteger(env.CLICK_BATCH_SIZE, 50),
      flushIntervalMs: parseInteger(env.CLICK_FLUSH_MS, 1_000),
      maxQueueSize: parseInteger(env.CLICK_QUEUE_MAX, 10_000),
    },
    rateLimit: {
      write: {
        maxRequests: parseInteger(env.RATE_LIMIT_MAX_REQUESTS, 10),
        windowMs: parseInteger(env.RATE_LIMIT_WINDOW_MS, 60_000),
      },
      redirect: {
        maxRequests: parseInteger(env.REDIRECT_RATE_LIMIT_MAX_REQUESTS, 600),
        windowMs: parseInteger(env.REDIRECT_RATE_LIMIT_WINDOW_MS, 60_000),
      },
      cleanupIntervalMs: parseInteger(env.RATE_LIMIT_CLEANUP_MS, 60_000),
      maxTrackedClients: parseInteger(env.RATE_LIMIT_MAX_CLIENTS, 100_000),
    },
  };

  return Object.freeze(config);
};
