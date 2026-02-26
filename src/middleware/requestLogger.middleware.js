import { silentLogger } from "../lib/logger.js";

/**
 * One structured line per request.
 *
 * Note what is absent: no client IP, no user-agent, no request body. Those are
 * analytics data with a defined home (`url_clicks`) and a defined retention
 * story; copying them into application logs would spread personal data into a
 * store nobody expires.
 */
export const createRequestLogger =
  ({ logger = silentLogger } = {}) =>
  (req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

      logger.info("request", {
        method: req.method,
        route: req.route?.path ?? req.path,
        status: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
      });
    });

    next();
  };
