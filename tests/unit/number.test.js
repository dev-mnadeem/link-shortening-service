import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { parseBoolean, parseInteger } from "../../src/utils/number.js";

describe("parseInteger", () => {
  test("parses a positive integer", () => {
    assert.equal(parseInteger("8080", 3000), 8080);
  });

  test("falls back for missing, blank and non-numeric values", () => {
    assert.equal(parseInteger(undefined, 3000), 3000);
    assert.equal(parseInteger(null, 3000), 3000);
    assert.equal(parseInteger("", 3000), 3000);
    assert.equal(parseInteger("   ", 3000), 3000);
    assert.equal(parseInteger("not-a-number", 3000), 3000);
  });

  test("rejects negative values", () => {
    assert.equal(parseInteger("-1", 3000), 3000);
  });

  test("rejects fractional values rather than producing a fractional port", () => {
    assert.equal(parseInteger("3.7", 3000), 3000);
  });

  test("rejects zero by default but accepts it when explicitly allowed", () => {
    assert.equal(parseInteger("0", 3000), 3000);
    assert.equal(parseInteger("0", 3000, { allowZero: true }), 0);
  });
});

describe("parseBoolean", () => {
  test("accepts common truthy and falsy spellings", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on"]) {
      assert.equal(parseBoolean(value, false), true, value);
    }

    for (const value of ["0", "false", "No", "off"]) {
      assert.equal(parseBoolean(value, true), false, value);
    }
  });

  test("falls back for unrecognised and missing values", () => {
    assert.equal(parseBoolean("maybe", true), true);
    assert.equal(parseBoolean(undefined, false), false);
  });
});
