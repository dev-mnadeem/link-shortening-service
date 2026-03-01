import assert from "node:assert/strict";
import test, { describe, beforeEach } from "node:test";
import { createLruCache } from "../../src/lib/lruCache.js";
import { createMemoryUrlRepository } from "../../src/repositories/memory.repository.js";
import { createUrlService } from "../../src/services/url.service.js";
import { AppError, DuplicateShortCodeError } from "../../src/utils/errors.js";

const createRecorderSpy = () => {
  const events = [];
  return { events, record: (event) => events.push(event) };
};

const buildService = ({ codes = ["code0001"], ...overrides } = {}) => {
  const repository = createMemoryUrlRepository();
  const clickRecorder = createRecorderSpy();
  const queue = [...codes];
  let generated = 0;

  const service = createUrlService({
    repository,
    clickRecorder,
    generateShortCode: () => {
      generated += 1;
      return queue.shift() ?? `fallback${String(generated).padStart(3, "0")}`;
    },
    ...overrides,
  });

  return { service, repository, clickRecorder };
};

const rejectsWith = async (promise, { statusCode, code }) => {
  let thrown = null;

  try {
    await promise;
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof AppError, "expected an AppError");
  assert.equal(thrown.statusCode, statusCode);
  assert.equal(thrown.code, code);

  return thrown;
};

describe("createShortUrl", () => {
  test("stores the normalized URL and returns its code", async () => {
    const { service, repository } = buildService({ codes: ["abcd1234"] });

    const result = await service.createShortUrl("  https://example.com/a  ");

    assert.deepEqual(result, { shortCode: "abcd1234", originalUrl: "https://example.com/a" });
    assert.equal(
      (await repository.findByShortCode("abcd1234")).original_url,
      "https://example.com/a",
    );
  });

  test("rejects an invalid URL before touching storage", async () => {
    const { service, repository } = buildService();

    await rejectsWith(service.createShortUrl("javascript:alert(1)"), {
      statusCode: 400,
      code: "VALIDATION_ERROR",
    });

    assert.equal(await repository.findByShortCode("code0001"), null);
  });

  test("retries on a short-code collision instead of failing", async () => {
    const { service, repository } = buildService({ codes: ["dupe0001", "dupe0001", "fresh001"] });

    await service.createShortUrl("https://example.com/first");
    const second = await service.createShortUrl("https://example.com/second");

    assert.equal(second.shortCode, "fresh001");
    assert.equal(
      (await repository.findByShortCode("dupe0001")).original_url,
      "https://example.com/first",
    );
  });

  test("gives up with a 503 after exhausting its attempts", async () => {
    let attempts = 0;
    const service = createUrlService({
      repository: {
        insertUrl: async ({ shortCode }) => {
          attempts += 1;
          throw new DuplicateShortCodeError(shortCode);
        },
      },
      clickRecorder: createRecorderSpy(),
      generateShortCode: () => "same0001",
      maxGenerationAttempts: 3,
    });

    await rejectsWith(service.createShortUrl("https://example.com/x"), {
      statusCode: 503,
      code: "CODE_GENERATION_FAILED",
    });

    assert.equal(attempts, 3);
  });

  test("propagates an unexpected storage failure untouched", async () => {
    const service = createUrlService({
      repository: {
        insertUrl: async () => {
          throw new Error("ER_LOCK_WAIT_TIMEOUT");
        },
      },
      clickRecorder: createRecorderSpy(),
      generateShortCode: () => "abcd1234",
    });

    await assert.rejects(
      () => service.createShortUrl("https://example.com"),
      /ER_LOCK_WAIT_TIMEOUT/,
    );
  });
});

describe("resolveShortUrl", () => {
  test("returns the stored row", async () => {
    const { service } = buildService({ codes: ["abcd1234"] });
    await service.createShortUrl("https://example.com/a");

    const record = await service.resolveShortUrl("abcd1234");

    assert.equal(record.original_url, "https://example.com/a");
  });

  test("404s an unknown code", async () => {
    const { service } = buildService();
    await rejectsWith(service.resolveShortUrl("nosuchco"), { statusCode: 404, code: "NOT_FOUND" });
  });

  test("404s an implausible code without querying storage", async () => {
    let queries = 0;
    const service = createUrlService({
      repository: {
        findByShortCode: async () => {
          queries += 1;
          return null;
        },
      },
      clickRecorder: createRecorderSpy(),
      generateShortCode: () => "abcd1234",
    });

    await rejectsWith(service.resolveShortUrl("favicon.ico"), {
      statusCode: 404,
      code: "NOT_FOUND",
    });
    assert.equal(queries, 0);
  });
});

describe("resolveShortUrl caching", () => {
  let queries;
  let service;
  let cache;

  beforeEach(() => {
    queries = 0;
    cache = createLruCache({ maxSize: 10, ttlMs: 60_000 });
    service = createUrlService({
      repository: {
        findByShortCode: async (shortCode) => {
          queries += 1;
          return shortCode === "abcd1234"
            ? { id: 1, short_code: shortCode, original_url: "https://example.com", click_count: 0 }
            : null;
        },
      },
      clickRecorder: createRecorderSpy(),
      generateShortCode: () => "abcd1234",
      cache,
      cacheMissTtlMs: 5_000,
    });
  });

  test("serves repeat lookups from cache", async () => {
    await service.resolveShortUrl("abcd1234");
    await service.resolveShortUrl("abcd1234");
    await service.resolveShortUrl("abcd1234");

    assert.equal(queries, 1);
    assert.equal(cache.stats().hits, 2);
  });

  test("caches misses so code scanning cannot become one query per guess", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await assert.rejects(() => service.resolveShortUrl("zzzz9999"));
    }

    assert.equal(queries, 1);
  });
});

describe("resolveAndRecordClick", () => {
  test("queues a click with the request metadata", async () => {
    const { service, clickRecorder } = buildService({ codes: ["abcd1234"] });
    await service.createShortUrl("https://example.com/a");

    const clickedAt = new Date("2026-02-27T12:00:00Z");
    await service.resolveAndRecordClick("abcd1234", {
      ipAddress: "203.0.113.7",
      userAgent: "Mozilla/5.0",
      clickedAt,
    });

    assert.deepEqual(clickRecorder.events, [
      { urlId: 1, ipAddress: "203.0.113.7", userAgent: "Mozilla/5.0", clickedAt },
    ]);
  });

  test("applies the configured IP privacy mode", async () => {
    const { service, clickRecorder } = buildService({
      codes: ["abcd1234"],
      ipMode: "anonymized",
    });

    await service.createShortUrl("https://example.com/a");
    await service.resolveAndRecordClick("abcd1234", { ipAddress: "203.0.113.7" });

    assert.equal(clickRecorder.events[0].ipAddress, "203.0.113.0");
  });

  test("substitutes a placeholder for a missing user agent", async () => {
    const { service, clickRecorder } = buildService({ codes: ["abcd1234"] });
    await service.createShortUrl("https://example.com/a");

    await service.resolveAndRecordClick("abcd1234", { ipAddress: "203.0.113.7" });

    assert.equal(clickRecorder.events[0].userAgent, "unknown");
  });

  test("truncates an oversized user agent to a column-safe length", async () => {
    const { service, clickRecorder } = buildService({ codes: ["abcd1234"] });
    await service.createShortUrl("https://example.com/a");

    await service.resolveAndRecordClick("abcd1234", { userAgent: "U".repeat(5_000) });

    assert.equal(clickRecorder.events[0].userAgent.length, 512);
  });

  test("records nothing for an unknown code", async () => {
    const { service, clickRecorder } = buildService();

    await assert.rejects(() => service.resolveAndRecordClick("nosuchco", {}));

    assert.equal(clickRecorder.events.length, 0);
  });
});
