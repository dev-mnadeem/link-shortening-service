import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";
import mysql from "mysql2/promise";
import { createMysqlUrlRepository } from "../../src/repositories/mysql.repository.js";
import { DuplicateShortCodeError } from "../../src/utils/errors.js";

/**
 * Exercises the raw SQL against a real MySQL server.
 *
 * Opt-in: the suite is skipped unless TEST_MYSQL=1, so `npm test` stays
 * runnable on a laptop with no database. CI (and the evidence capture in
 * docs/) runs it with a throwaway server.
 *
 *   TEST_MYSQL=1 DB_PORT=8526 DB_NAME=url_shortener_test npm test
 */
const enabled = process.env.TEST_MYSQL === "1";

describe("mysql url repository", { skip: enabled ? false : "set TEST_MYSQL=1 to run" }, () => {
  let pool;
  let repository;

  before(async () => {
    pool = mysql.createPool({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "url_shortener_test",
      connectionLimit: 4,
    });

    repository = createMysqlUrlRepository({ pool });

    await pool.query("DELETE FROM url_clicks");
    await pool.query("DELETE FROM urls");
  });

  after(async () => {
    await pool.end();
  });

  test("ping succeeds against a live server", async () => {
    assert.equal(await repository.ping(), true);
  });

  test("inserts and reads back a mapping", async () => {
    const id = await repository.insertUrl({
      shortCode: "sqlTest1",
      originalUrl: "https://example.com/sql",
    });

    const record = await repository.findByShortCode("sqlTest1");

    assert.equal(record.id, id);
    assert.equal(record.original_url, "https://example.com/sql");
    assert.equal(Number(record.click_count), 0);
  });

  test("returns null for an unknown code", async () => {
    assert.equal(await repository.findByShortCode("nosuchco"), null);
  });

  test("maps a unique-index violation to a domain error", async () => {
    await repository.insertUrl({ shortCode: "dupeTst1", originalUrl: "https://example.com/1" });

    await assert.rejects(
      () => repository.insertUrl({ shortCode: "dupeTst1", originalUrl: "https://example.com/2" }),
      DuplicateShortCodeError,
    );
  });

  test("writes a click batch as one insert plus one grouped update", async () => {
    const firstId = await repository.insertUrl({
      shortCode: "batchAa1",
      originalUrl: "https://example.com/a",
    });
    const secondId = await repository.insertUrl({
      shortCode: "batchBb1",
      originalUrl: "https://example.com/b",
    });

    const clickedAt = new Date();
    const written = await repository.recordClicks([
      { urlId: firstId, ipAddress: "203.0.113.1", userAgent: "curl/8", clickedAt },
      { urlId: firstId, ipAddress: "203.0.113.2", userAgent: "curl/8", clickedAt },
      { urlId: secondId, ipAddress: "203.0.113.3", userAgent: "curl/8", clickedAt },
    ]);

    assert.equal(written, 3);
    assert.equal(Number((await repository.findByShortCode("batchAa1")).click_count), 2);
    assert.equal(Number((await repository.findByShortCode("batchBb1")).click_count), 1);

    const [rows] = await pool.query(
      "SELECT url_id, ip_address FROM url_clicks WHERE url_id IN (?, ?) ORDER BY id",
      [firstId, secondId],
    );

    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((row) => row.ip_address),
      ["203.0.113.1", "203.0.113.2", "203.0.113.3"],
    );
  });

  test("a batch containing a hostile user agent is bound, not interpolated", async () => {
    const id = await repository.insertUrl({
      shortCode: "injectQ1",
      originalUrl: "https://example.com/inject",
    });

    await repository.recordClicks([
      {
        urlId: id,
        ipAddress: "203.0.113.9",
        userAgent: "'); DROP TABLE urls; -- ",
        clickedAt: new Date(),
      },
    ]);

    const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM urls");
    assert.ok(Number(total) > 0, "urls table must still exist and hold rows");
  });

  test("an empty batch is a no-op", async () => {
    assert.equal(await repository.recordClicks([]), 0);
  });
});
