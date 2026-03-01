import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  CODE_ALPHABET,
  createShortCodeGenerator,
  isPlausibleShortCode,
} from "../../src/utils/shortCode.js";

describe("createShortCodeGenerator", () => {
  test("produces codes of the requested length from the base62 alphabet", () => {
    const generate = createShortCodeGenerator({ length: 8 });

    for (let index = 0; index < 200; index += 1) {
      const code = generate();
      assert.equal(code.length, 8);
      assert.match(code, /^[A-Za-z0-9]{8}$/);
    }
  });

  test("honours a custom length", () => {
    assert.equal(createShortCodeGenerator({ length: 3 })().length, 3);
  });

  test("rejects a non-positive length", () => {
    assert.throws(() => createShortCodeGenerator({ length: 0 }), TypeError);
    assert.throws(() => createShortCodeGenerator({ length: 2.5 }), TypeError);
  });

  test("asks the randomness source for an index within the alphabet", () => {
    const requestedBounds = [];
    const generate = createShortCodeGenerator({
      length: 4,
      randomIndex: (max) => {
        requestedBounds.push(max);
        return 0;
      },
    });

    assert.equal(generate(), CODE_ALPHABET[0].repeat(4));
    assert.deepEqual(requestedBounds, [62, 62, 62, 62]);
  });

  test("does not repeat itself across a large sample", () => {
    const generate = createShortCodeGenerator();
    const codes = new Set();

    for (let index = 0; index < 5_000; index += 1) {
      codes.add(generate());
    }

    assert.equal(codes.size, 5_000);
  });
});

describe("isPlausibleShortCode", () => {
  test("accepts well-formed codes", () => {
    assert.equal(isPlausibleShortCode("Ab12xyZ9"), true);
  });

  test("rejects the shapes that would otherwise cost a database round trip", () => {
    assert.equal(isPlausibleShortCode(""), false);
    assert.equal(isPlausibleShortCode("favicon.ico"), false);
    assert.equal(isPlausibleShortCode("a".repeat(17)), false);
    assert.equal(isPlausibleShortCode("has space"), false);
    assert.equal(isPlausibleShortCode(undefined), false);
    assert.equal(isPlausibleShortCode(42), false);
  });
});
