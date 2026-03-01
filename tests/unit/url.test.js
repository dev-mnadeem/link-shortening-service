import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { MAX_URL_LENGTH, normalizeLongUrl } from "../../src/utils/url.js";
import { AppError } from "../../src/utils/errors.js";

const expectValidationError = (input) => {
  let thrown = null;

  try {
    normalizeLongUrl(input);
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof AppError, `expected an AppError for ${String(input)}`);
  assert.equal(thrown.statusCode, 400);
  assert.equal(thrown.code, "VALIDATION_ERROR");

  return thrown;
};

describe("normalizeLongUrl", () => {
  test("returns the normalized absolute URL", () => {
    assert.equal(normalizeLongUrl("https://example.com/a/b"), "https://example.com/a/b");
    assert.equal(normalizeLongUrl("  https://example.com  "), "https://example.com/");
    assert.equal(normalizeLongUrl("HTTP://Example.com/Path"), "http://example.com/Path");
  });

  test("requires a non-empty string", () => {
    expectValidationError(undefined);
    expectValidationError("");
    expectValidationError("   ");
    expectValidationError(42);
  });

  test("rejects malformed and relative URLs", () => {
    expectValidationError("not a url");
    expectValidationError("/relative/path");
  });

  test("rejects non-http protocols", () => {
    for (const input of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "ftp://example.com/file",
    ]) {
      expectValidationError(input);
    }
  });

  test("rejects URLs beyond the column-safe length", () => {
    const error = expectValidationError(`https://example.com/${"a".repeat(MAX_URL_LENGTH)}`);
    assert.equal(error.details.maxLength, MAX_URL_LENGTH);
  });

  test("percent-encodes CR/LF so a stored URL cannot inject a response header", () => {
    const normalized = normalizeLongUrl("https://example.com/a\r\nX-Injected: 1");
    assert.ok(!normalized.includes("\r"));
    assert.ok(!normalized.includes("\n"));
  });
});
