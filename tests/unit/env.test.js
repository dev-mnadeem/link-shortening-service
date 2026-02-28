import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { loadConfig } from "../../src/config/env.js";

describe("loadConfig", () => {
  test("applies documented defaults", () => {
    const config = loadConfig({});

    assert.equal(config.app.port, 3000);
    assert.equal(config.app.baseUrl, "http://localhost:3000");
    assert.equal(config.app.trustProxy, false);
    assert.equal(config.storage.driver, "mysql");
    assert.equal(config.db.port, 3306);
    assert.equal(config.rateLimit.write.maxRequests, 10);
    assert.equal(config.rateLimit.write.windowMs, 60_000);
    assert.equal(config.clicks.ipMode, "full");
  });

  test("reads overrides from the supplied environment", () => {
    const config = loadConfig({
      PORT: "8520",
      STORAGE_DRIVER: "memory",
      TRUST_PROXY: "true",
      CLICK_IP_MODE: "anonymized",
      RATE_LIMIT_MAX_REQUESTS: "3",
    });

    assert.equal(config.app.port, 8520);
    assert.equal(config.storage.driver, "memory");
    assert.equal(config.app.trustProxy, true);
    assert.equal(config.clicks.ipMode, "anonymized");
    assert.equal(config.rateLimit.write.maxRequests, 3);
  });

  test("trims trailing slashes from BASE_URL so links are not doubled", () => {
    assert.equal(loadConfig({ BASE_URL: "https://sho.rt///" }).app.baseUrl, "https://sho.rt");
  });

  test("falls back rather than accepting an unknown enum value", () => {
    assert.equal(loadConfig({ STORAGE_DRIVER: "cassandra" }).storage.driver, "mysql");
    assert.equal(loadConfig({ CLICK_IP_MODE: "hashed" }).clicks.ipMode, "full");
  });

  test("returns a frozen configuration", () => {
    const config = loadConfig({});
    assert.throws(() => {
      config.app = {};
    }, TypeError);
  });
});
