import { createApp } from "./app.js";
import { createUrlController } from "./controllers/url.controller.js";
import { createLruCache } from "./lib/lruCache.js";
import { createLogger } from "./lib/logger.js";
import { createRateLimiter } from "./middleware/rateLimiter.middleware.js";
import { createUrlRepository } from "./repositories/index.js";
import { createClickRecorder } from "./services/clickRecorder.js";
import { createUrlService } from "./services/url.service.js";
import { createShortCodeGenerator } from "./utils/shortCode.js";

/**
 * Composition root.
 *
 * Every `new`/`create` in the application happens here, once, in dependency
 * order. Nothing below this file imports a singleton, which is what keeps the
 * layers independently testable.
 */
export const createContainer = (config, overrides = {}) => {
  const logger = overrides.logger ?? createLogger({ level: config.app.logLevel });
  const repository = overrides.repository ?? createUrlRepository(config);

  const clickRecorder =
    overrides.clickRecorder ??
    createClickRecorder({
      repository,
      batchSize: config.clicks.batchSize,
      flushIntervalMs: config.clicks.flushIntervalMs,
      maxQueueSize: config.clicks.maxQueueSize,
      logger,
    });

  const cache = createLruCache({
    maxSize: config.cache.maxSize,
    ttlMs: config.cache.ttlMs,
  });

  const urlService = createUrlService({
    repository,
    clickRecorder,
    cache,
    cacheMissTtlMs: config.cache.missTtlMs,
    generateShortCode: createShortCodeGenerator({ length: config.shortCode.length }),
    maxGenerationAttempts: config.shortCode.maxGenerationAttempts,
    ipMode: config.clicks.ipMode,
  });

  const urlController = createUrlController({ urlService, baseUrl: config.app.baseUrl });

  const writeLimiter = createRateLimiter({
    maxRequests: config.rateLimit.write.maxRequests,
    windowMs: config.rateLimit.write.windowMs,
    cleanupIntervalMs: config.rateLimit.cleanupIntervalMs,
    maxTrackedClients: config.rateLimit.maxTrackedClients,
  });

  const redirectLimiter = createRateLimiter({
    maxRequests: config.rateLimit.redirect.maxRequests,
    windowMs: config.rateLimit.redirect.windowMs,
    cleanupIntervalMs: config.rateLimit.cleanupIntervalMs,
    maxTrackedClients: config.rateLimit.maxTrackedClients,
  });

  const app = createApp({
    urlController,
    repository,
    writeLimiter: writeLimiter.middleware,
    redirectLimiter: redirectLimiter.middleware,
    trustProxy: config.app.trustProxy,
    logger,
  });

  const start = () => {
    clickRecorder.start();
    writeLimiter.start();
    redirectLimiter.start();
  };

  /** Stops timers and drains buffered analytics before the pool is closed. */
  const stop = async () => {
    writeLimiter.stop();
    redirectLimiter.stop();
    await clickRecorder.close();
    await repository.close();
  };

  return {
    app,
    config,
    logger,
    repository,
    urlService,
    clickRecorder,
    cache,
    writeLimiter,
    redirectLimiter,
    start,
    stop,
  };
};
