import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createLruCache } from "../../src/lib/lruCache.js";

const createClock = (startAt = 0) => {
  let current = startAt;
  return { now: () => current, advance: (ms) => (current += ms) };
};

describe("createLruCache", () => {
  test("stores and returns values", () => {
    const cache = createLruCache({ maxSize: 2 });
    cache.set("a", 1);
    assert.equal(cache.get("a"), 1);
    assert.equal(cache.get("missing"), undefined);
  });

  test("evicts the least recently used entry when full", () => {
    const cache = createLruCache({ maxSize: 2 });

    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // "a" is now the most recently used.
    cache.set("c", 3);

    assert.equal(cache.get("b"), undefined);
    assert.equal(cache.get("a"), 1);
    assert.equal(cache.get("c"), 3);
    assert.equal(cache.size, 2);
  });

  test("never grows beyond maxSize", () => {
    const cache = createLruCache({ maxSize: 10 });

    for (let index = 0; index < 1_000; index += 1) {
      cache.set(`key-${index}`, index);
    }

    assert.equal(cache.size, 10);
  });

  test("expires entries once the TTL has elapsed", () => {
    const clock = createClock();
    const cache = createLruCache({ maxSize: 10, ttlMs: 100, now: clock.now });

    cache.set("a", 1);
    clock.advance(99);
    assert.equal(cache.get("a"), 1);

    clock.advance(1);
    assert.equal(cache.get("a"), undefined);
    assert.equal(cache.size, 0);
  });

  test("honours a per-entry TTL override", () => {
    const clock = createClock();
    const cache = createLruCache({ maxSize: 10, ttlMs: 10_000, now: clock.now });

    cache.set("short", 1, 50);
    cache.set("long", 2);
    clock.advance(51);

    assert.equal(cache.get("short"), undefined);
    assert.equal(cache.get("long"), 2);
  });

  test("overwriting a key does not consume an extra slot", () => {
    const cache = createLruCache({ maxSize: 2 });

    cache.set("a", 1);
    cache.set("a", 2);
    cache.set("b", 3);

    assert.equal(cache.get("a"), 2);
    assert.equal(cache.get("b"), 3);
  });

  test("reports hit, miss and eviction counts", () => {
    const cache = createLruCache({ maxSize: 1 });

    cache.set("a", 1);
    cache.get("a");
    cache.get("b");
    cache.set("c", 3);

    assert.deepEqual(cache.stats(), { hits: 1, misses: 1, evictions: 1, size: 1 });
  });

  test("rejects a nonsensical size", () => {
    assert.throws(() => createLruCache({ maxSize: 0 }), TypeError);
  });
});
