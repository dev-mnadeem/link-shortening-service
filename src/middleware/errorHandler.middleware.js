import { randomUUID } from "node:crypto";
import { AppError, createNotFoundError } from "../utils/errors.js";
import { silentLogger } from "../lib/logger.js";

export const notFoundHandler = (_req, _res, next) => {
  next(createNotFoundError("Route not found."));
};

/**
 * Terminal error handler.
 *
 * The rule it enforces: a client sees the message of an `AppError` (which the
 * application authored deliberately) and never the message of anything else.
 * The previous version echoed `error.message` for every status, so a driver
 * failure would return the database host, user and SQL text to the caller.
 * Unexpected errors get a correlation id instead - logged in full, opaque on
 * the wire.
 */
export const createErrorHandler =
  ({ logger = silentLogger } = {}) =>
  // eslint-disable-next-line no-unused-vars -- Express identifies the error handler by arity.
  (error, req, res, next) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        logger.error(error.message, { code: error.code, path: req.path });
      }

      res.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null,
        },
      });
      return;
    }

    // Body-parser and friends signal intent with `status`/`statusCode`.
    const bodyParserStatus = error?.status ?? error?.statusCode;

    if (Number.isInteger(bodyParserStatus) && bodyParserStatus >= 400 && bodyParserStatus < 500) {
      const isTooLarge = bodyParserStatus === 413;

      res.status(bodyParserStatus).json({
        error: {
          code: isTooLarge ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST",
          message: isTooLarge ? "Request body too large." : "Malformed request body.",
          details: null,
        },
      });
      return;
    }

    const incidentId = randomUUID();

    logger.error("Unhandled error.", {
      incidentId,
      path: req.path,
      method: req.method,
      reason: error?.message,
      stack: error?.stack,
    });

    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected server error.",
        details: { incidentId },
      },
    });
  };
