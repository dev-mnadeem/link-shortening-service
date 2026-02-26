import { DuplicateShortCodeError } from "../utils/errors.js";

/**
 * In-memory implementation of the same port.
 *
 * Exists for two reasons: the test suite runs the real HTTP stack end to end
 * without a database, and `STORAGE_DRIVER=memory` gives a reviewer a one
 * command demo. It is explicitly not a production store - state dies with the
 * process and does not span instances.
 */
export const createMemoryUrlRepository = ({ now = () => new Date() } = {}) => {
  const urlsByShortCode = new Map();
  const urlsById = new Map();
  const clickEvents = [];
  let nextId = 1;

  return {
    driver: "memory",

    async findByShortCode(shortCode) {
      const record = urlsByShortCode.get(shortCode);
      return record ? { ...record } : null;
    },

    async insertUrl({ shortCode, originalUrl }) {
      if (urlsByShortCode.has(shortCode)) {
        throw new DuplicateShortCodeError(shortCode);
      }

      const record = {
        id: nextId,
        short_code: shortCode,
        original_url: originalUrl,
        click_count: 0,
        created_at: now(),
      };

      nextId += 1;
      urlsByShortCode.set(shortCode, record);
      urlsById.set(record.id, record);

      return record.id;
    },

    async recordClicks(events) {
      for (const event of events) {
        const record = urlsById.get(event.urlId);

        if (!record) {
          continue;
        }

        record.click_count += 1;
        clickEvents.push({ ...event });
      }

      return events.length;
    },

    async ping() {
      return true;
    },

    async close() {
      urlsByShortCode.clear();
      urlsById.clear();
      clickEvents.length = 0;
    },

    /** Test-only inspection helper; not part of the repository port. */
    _debug: { clickEvents, urlsById },
  };
};
