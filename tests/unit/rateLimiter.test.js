import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createRateLimiter } from "../../src/middleware/rateLimiter.middleware.js";
import { AppError } from "../../src/utils/errors.js";

const createResponseStub = () => {
  const headers = {};
  return { headers, set: (name, value) => (headers[name] = value) };
};

const runRequest = (limiter, ip = "203.0.113.1") => {
  const res = createResponseStub();
  let forwardedError;

  limiter.middleware({ ip, socket: {} }, res, (error) => {
    forwardedError = error;
  });

  return { res, error: forwardedError };
};

describe("createRateLimiter", () => {
  test("allows exactly maxRequests within a window", () => {
    const limiter = createRateLimiter({ maxRequests: 3, windowMs: 1_000 });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      assert.equal(runRequest(limiter).error, undefined, `request ${attempt + 1}`);
    }

    const { error } = runRequest(limiter);
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 429);
    assert.equal(error.code, "RATE_LIMIT_EXCEEDED");
    assert.equal(error.details.limit, 3);
  });

  test("counts each client independently", () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 1_000 });

    assert.equal(runRequest(limiter, "198.51.100.1").error, undefined);
    assert.equal(runRequest(limiter, "198.51.100.2").error, undefined);
    assert.ok(runRequest(limiter, "198.51.100.1").error);
  });

  test("starts a fresh window once the old one expires", () => {
    let currentTime = 0;
    const limiter = createRateLimiter({
      maxRequests: 1,
      windowMs: 1_000,
      now: () => currentTime,
    });

    assert.equal(runRequest(limiter).error, undefined);
    assert.ok(runRequest(limiter).error);

    currentTime = 1_000;
    assert.equal(runRequest(limiter).error, undefined);
  });

  test("advertises the limit and a Retry-After on rejection", () => {
    let currentTime = 0;
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 5_000, now: () => currentTime });

    const first = runRequest(limiter);
    assert.equal(first.res.headers["RateLimit-Limit"], "1");
    assert.equal(first.res.headers["RateLimit-Remaining"], "0");

    currentTime = 1_500;
    const rejected = runRequest(limiter);
    assert.equal(rejected.res.headers["Retry-After"], "4");
  });

  test("bounds the number of tracked clients", () => {
    const limiter = createRateLimiter({
      maxRequests: 10,
      windowMs: 60_000,
      maxTrackedClients: 5,
    });

    for (let index = 0; index < 500; index += 1) {
      runRequest(limiter, `10.0.0.${index}`);
    }

    assert.ok(limiter.size <= 5, `expected <= 5 tracked clients, got ${limiter.size}`);
  });

  test("stop() clears the sweep timer so instances do not leak", () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 10, cleanupIntervalMs: 10 });

    limiter.start();
    limiter.start(); // idempotent
    limiter.stop();
    limiter.stop(); // idempotent

    assert.equal(limiter.size, 0);
  });

  test("falls back to the socket address when req.ip is absent", () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 1_000 });
    const next = () => {};

    limiter.middleware({ socket: { remoteAddress: "192.0.2.9" } }, createResponseStub(), next);

    assert.equal(limiter.size, 1);
  });
});
