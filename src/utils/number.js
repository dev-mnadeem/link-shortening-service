/**
 * Parses an environment-style value into a positive integer.
 *
 * Returns `fallback` when the value is absent, non-numeric, non-integral,
 * or negative. Zero is accepted only when `allowZero` is set, which matters
 * for `PORT=0` (bind an ephemeral port, used by the test suite).
 */
export const parseInteger = (value, fallback, { allowZero = false } = {}) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  if (parsed < 0 || (parsed === 0 && !allowZero)) {
    return fallback;
  }

  return parsed;
};

/**
 * Parses an environment-style boolean. Accepts `1/true/yes/on` (and their
 * negatives) case-insensitively; anything else falls back.
 */
export const parseBoolean = (value, fallback) => {
  if (value === undefined || value === null) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
};
