import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  buildIncrementClickCountsQuery,
  buildInsertClickEventsQuery,
} from "../../src/constants/queries.js";

const countPlaceholders = (sql) => (sql.match(/\?/g) ?? []).length;

describe("buildInsertClickEventsQuery", () => {
  test("collapses a batch into one multi-row insert", () => {
    const clickedAt = new Date("2026-02-27T00:00:00Z");
    const { sql, params } = buildInsertClickEventsQuery([
      { urlId: 1, ipAddress: "203.0.113.1", userAgent: "curl", clickedAt },
      { urlId: 2, ipAddress: "203.0.113.2", userAgent: "wget", clickedAt },
    ]);

    assert.match(sql, /INSERT INTO url_clicks/);
    assert.match(sql, /VALUES \(\?, \?, \?, \?\), \(\?, \?, \?, \?\)$/);
    assert.deepEqual(params, [
      1,
      "203.0.113.1",
      "curl",
      clickedAt,
      2,
      "203.0.113.2",
      "wget",
      clickedAt,
    ]);
  });

  test("binds every value as a placeholder, never as literal SQL", () => {
    const { sql, params } = buildInsertClickEventsQuery([
      {
        urlId: 1,
        ipAddress: "1.1.1.1",
        userAgent: "'); DROP TABLE urls; --",
        clickedAt: new Date(),
      },
    ]);

    assert.equal(countPlaceholders(sql), params.length);
    assert.ok(!sql.includes("DROP TABLE"));
  });

  test("refuses an empty batch instead of emitting invalid SQL", () => {
    assert.throws(() => buildInsertClickEventsQuery([]), RangeError);
  });
});

describe("buildIncrementClickCountsQuery", () => {
  test("applies a per-row increment in a single statement", () => {
    const { sql, params } = buildIncrementClickCountsQuery(
      new Map([
        [7, 3],
        [9, 1],
      ]),
    );

    assert.match(
      sql,
      /SET click_count = click_count \+ CASE id WHEN \? THEN \? WHEN \? THEN \? ELSE 0 END/,
    );
    assert.match(sql, /WHERE id IN \(\?, \?\)/);
    assert.deepEqual(params, [7, 3, 9, 1, 7, 9]);
    assert.equal(countPlaceholders(sql), params.length);
  });

  test("refuses an empty count map", () => {
    assert.throws(() => buildIncrementClickCountsQuery(new Map()), RangeError);
  });
});
