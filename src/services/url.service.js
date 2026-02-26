import { anonymizeIp } from "../utils/ip.js";
import { normalizeLongUrl } from "../utils/url.js";
import {
  DuplicateShortCodeError,
  createNotFoundError,
  createServiceUnavailableError,
} from "../utils/errors.js";
import { isPlausibleShortCode } from "../utils/shortCode.js";

/** `url_clicks.user_agent` is TEXT; a hostile client should not get to test that. */
const MAX_USER_AGENT_LENGTH = 512;

/** Cached stand-in for "this code definitely does not exist". */
const NEGATIVE_CACHE_MARKER = Symbol("short-code-miss");

/**
 * Core business logic, with every dependency injected.
 *
 * It knows nothing about Express (no `req`/`res`) and nothing about MySQL (no
 * driver error codes) - which is exactly why all of it is unit testable
 * against the in-memory repository.
 */
export const createUrlService = ({
  repository,
  generateShortCode,
  clickRecorder,
  cache = null,
  cacheMissTtlMs = 5_000,
  maxGenerationAttempts = 5,
  ipMode = "full",
}) => {
  /**
   * Read-through cache for code -> row.
   *
   * Safe because rows are immutable once written: there is no update or delete
   * endpoint, so a cached destination cannot go stale. Misses are cached too,
   * briefly, so that scanning random codes cannot turn into one query per guess.
   */
  const readThroughCache = async (shortCode) => {
    const cached = cache?.get(shortCode);

    if (cached === NEGATIVE_CACHE_MARKER) {
      return null;
    }

    if (cached !== undefined) {
      return cached;
    }

    const urlRecord = await repository.findByShortCode(shortCode);

    if (urlRecord) {
      cache?.set(shortCode, urlRecord);
    } else {
      cache?.set(shortCode, NEGATIVE_CACHE_MARKER, cacheMissTtlMs);
    }

    return urlRecord;
  };

  const service = {
    /**
     * Creates a short code for a long URL.
     *
     * Collisions are resolved by retrying against the unique index rather than
     * by a read-then-write check: SELECT-before-INSERT is a race, and with
     * 62^8 codes the retry branch is effectively never taken.
     */
    async createShortUrl(originalUrl) {
      const normalizedUrl = normalizeLongUrl(originalUrl);

      for (let attempt = 0; attempt < maxGenerationAttempts; attempt += 1) {
        const shortCode = generateShortCode();

        try {
          await repository.insertUrl({ shortCode, originalUrl: normalizedUrl });

          return { shortCode, originalUrl: normalizedUrl };
        } catch (error) {
          if (error instanceof DuplicateShortCodeError) {
            continue;
          }

          throw error;
        }
      }

      throw createServiceUnavailableError(
        "Could not generate a unique short code. Please retry.",
        "CODE_GENERATION_FAILED",
      );
    },

    /** Resolves a short code to its stored row, or throws a 404. */
    async resolveShortUrl(shortCode) {
      if (!isPlausibleShortCode(shortCode)) {
        throw createNotFoundError("Short URL not found.");
      }

      const urlRecord = await readThroughCache(shortCode);

      if (!urlRecord) {
        throw createNotFoundError("Short URL not found.");
      }

      return urlRecord;
    },

    /**
     * Resolves a short code and queues its click for analytics.
     *
     * Returns as soon as the destination is known; the click is persisted on
     * the recorder's next flush.
     */
    async resolveAndRecordClick(shortCode, requestMetadata = {}) {
      const urlRecord = await service.resolveShortUrl(shortCode);

      clickRecorder.record({
        urlId: urlRecord.id,
        ipAddress: anonymizeIp(requestMetadata.ipAddress, ipMode),
        userAgent: String(requestMetadata.userAgent || "unknown").slice(0, MAX_USER_AGENT_LENGTH),
        clickedAt: requestMetadata.clickedAt ?? new Date(),
      });

      return urlRecord;
    },
  };

  return service;
};
