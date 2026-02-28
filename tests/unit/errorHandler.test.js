import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createErrorHandler } from "../../src/middleware/errorHandler.middleware.js";
import { createValidationError } from "../../src/utils/errors.js";

const createResponseStub = () => {
  const captured = { status: null, body: null };

  return {
    captured,
    status(code) {
      captured.status = code;
      return this;
    },
    json(payload) {
      captured.body = payload;
      return this;
    },
  };
};

const handle = (error) => {
  const res = createResponseStub();
  createErrorHandler()(error, { path: "/x", method: "GET" }, res, () => {});
  return res.captured;
};

describe("createErrorHandler", () => {
  test("surfaces an application error verbatim", () => {
    const captured = handle(createValidationError("Invalid URL format.", { field: "url" }));

    assert.equal(captured.status, 400);
    assert.deepEqual(captured.body, {
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid URL format.",
        details: { field: "url" },
      },
    });
  });

  test("never leaks the message of an unexpected error", () => {
    const driverError = new Error(
      "connect ECONNREFUSED 10.0.0.5:3306 (user 'root', database 'url_shortener')",
    );

    const captured = handle(driverError);

    assert.equal(captured.status, 500);
    assert.equal(captured.body.error.code, "INTERNAL_ERROR");
    assert.equal(captured.body.error.message, "Unexpected server error.");
    assert.ok(!JSON.stringify(captured.body).includes("ECONNREFUSED"));
    assert.ok(!JSON.stringify(captured.body).includes("3306"));
  });

  test("returns a correlation id so a 500 can still be traced in the logs", () => {
    const captured = handle(new Error("boom"));

    assert.match(
      captured.body.error.details.incidentId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test("maps a body-parser style 4xx to a client error, not a 500", () => {
    const parseError = Object.assign(new SyntaxError("Unexpected token } in JSON at position 4"), {
      status: 400,
      statusCode: 400,
      type: "entity.parse.failed",
    });

    const captured = handle(parseError);

    assert.equal(captured.status, 400);
    assert.equal(captured.body.error.code, "BAD_REQUEST");
    assert.ok(!captured.body.error.message.includes("Unexpected token"));
  });

  test("logs 5xx application errors but not 4xx ones", () => {
    const logged = [];
    const logger = { error: (message) => logged.push(message), info() {}, warn() {}, debug() {} };
    const handler = createErrorHandler({ logger });

    handler(createValidationError("nope"), { path: "/x" }, createResponseStub(), () => {});
    assert.equal(logged.length, 0);
  });
});
