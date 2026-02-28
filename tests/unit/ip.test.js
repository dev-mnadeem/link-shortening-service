import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { anonymizeIp } from "../../src/utils/ip.js";

describe("anonymizeIp", () => {
  test("stores the address verbatim in full mode", () => {
    assert.equal(anonymizeIp("203.0.113.42", "full"), "203.0.113.42");
  });

  test("drops the final IPv4 octet in anonymized mode", () => {
    assert.equal(anonymizeIp("203.0.113.42", "anonymized"), "203.0.113.0");
  });

  test("keeps only the /48 prefix of an IPv6 address in anonymized mode", () => {
    assert.equal(
      anonymizeIp("2001:db8:85a3:8d3:1319:8a2e:370:7348", "anonymized"),
      "2001:db8:85a3::",
    );
  });

  test("stores nothing identifying in none mode", () => {
    assert.equal(anonymizeIp("203.0.113.42", "none"), "redacted");
  });

  test("substitutes a placeholder when the address is missing", () => {
    assert.equal(anonymizeIp(undefined, "full"), "unknown");
    assert.equal(anonymizeIp("", "anonymized"), "unknown");
  });

  test("never exceeds the ip_address column width", () => {
    assert.ok(anonymizeIp("a".repeat(200), "full").length <= 64);
  });
});
