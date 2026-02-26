import { randomInt } from "node:crypto";

/** Base62 alphabet: URL-safe, no escaping needed in a path segment. */
export const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export const DEFAULT_CODE_LENGTH = 8;

const SHORT_CODE_PATTERN = /^[A-Za-z0-9]+$/;

/**
 * Builds a short-code generator.
 *
 * Uses `crypto.randomInt` rather than `Math.random`: short codes are the only
 * thing protecting a link from enumeration, and `Math.random` is a seeded PRNG
 * whose output is predictable from prior samples. `randomInt` is also rejection
 * sampled, so the base62 alphabet stays uniformly distributed.
 */
export const createShortCodeGenerator = ({
  length = DEFAULT_CODE_LENGTH,
  alphabet = CODE_ALPHABET,
  randomIndex = (max) => randomInt(max),
} = {}) => {
  if (!Number.isInteger(length) || length < 1) {
    throw new TypeError("Short code length must be a positive integer.");
  }

  return () => {
    let code = "";

    for (let index = 0; index < length; index += 1) {
      code += alphabet[randomIndex(alphabet.length)];
    }

    return code;
  };
};

/**
 * Cheap shape check used before touching the database. A request for
 * `/favicon.ico` or a 4 KB path is rejected without a query.
 */
export const isPlausibleShortCode = (value, maxLength = 16) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maxLength &&
  SHORT_CODE_PATTERN.test(value);
