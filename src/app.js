import express from "express";
import { createHealthRouter } from "./routes/health.route.js";
import { createUrlRouter } from "./routes/url.route.js";
import { createErrorHandler, notFoundHandler } from "./middleware/errorHandler.middleware.js";
import { createRequestLogger } from "./middleware/requestLogger.middleware.js";
import { silentLogger } from "./lib/logger.js";

/** Request bodies are one short URL; anything larger is not a real client. */
const JSON_BODY_LIMIT = "10kb";

/**
 * Builds the Express application from already-constructed collaborators.
 *
 * `createApp` never reads `process.env` and never opens a connection, so a
 * test can stand up the real middleware stack against an in-memory repository
 * in microseconds. Wiring lives in `container.js`; process concerns live in
 * `server.js`.
 */
export const createApp = ({
  urlController,
  repository,
  writeLimiter,
  redirectLimiter,
  trustProxy = false,
  logger = silentLogger,
}) => {
  const app = express();

  app.disable("x-powered-by");
  // Only enabled when a trusted proxy is guaranteed to rewrite
  // X-Forwarded-For; otherwise `req.ip` is client-controlled and the rate
  // limiter is bypassable with one header.
  app.set("trust proxy", trustProxy);

  app.use(createRequestLogger({ logger }));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.use(createHealthRouter({ repository }));
  app.use(createUrlRouter({ urlController, writeLimiter, redirectLimiter }));

  app.use(notFoundHandler);
  app.use(createErrorHandler({ logger }));

  return app;
};
