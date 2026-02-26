/**
 * Application-level error carrying the HTTP status and a stable machine code.
 *
 * Only errors of this type have their `message` surfaced to clients; anything
 * else is reported as a generic 500 so that driver/SQL internals never leak.
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, code = "INTERNAL_ERROR", details = null) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.expose = statusCode < 500;
  }
}

/** Raised by a repository when a short code collides with an existing row. */
export class DuplicateShortCodeError extends Error {
  constructor(shortCode) {
    super(`Short code already in use: ${shortCode}`);
    this.name = "DuplicateShortCodeError";
    this.shortCode = shortCode;
  }
}

export const createValidationError = (message, details = null) =>
  new AppError(message, 400, "VALIDATION_ERROR", details);

export const createNotFoundError = (message) => new AppError(message, 404, "NOT_FOUND");

export const createRateLimitError = (message, details = null) =>
  new AppError(message, 429, "RATE_LIMIT_EXCEEDED", details);

export const createServiceUnavailableError = (message, code = "SERVICE_UNAVAILABLE") =>
  new AppError(message, 503, code);
