import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { describe } from "node:test";
import { fileURLToPath } from "node:url";
import { splitSqlStatements } from "../../scripts/lib/splitSqlStatements.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("splitSqlStatements", () => {
  test("splits on statement terminators", () => {
    assert.deepEqual(splitSqlStatements("SELECT 1; SELECT 2;"), ["SELECT 1", "SELECT 2"]);
  });

  test("ignores a trailing statement without a terminator", () => {
    assert.deepEqual(splitSqlStatements("SELECT 1"), ["SELECT 1"]);
  });

  test("does not split on a semicolon inside a string literal", () => {
    assert.deepEqual(splitSqlStatements("INSERT INTO t VALUES ('a;b');"), [
      "INSERT INTO t VALUES ('a;b')",
    ]);
  });

  test("does not split on a semicolon inside a quoted identifier", () => {
    assert.deepEqual(splitSqlStatements("SELECT `we;ird` FROM t;"), ["SELECT `we;ird` FROM t"]);
  });

  test("strips line and block comments", () => {
    const statements = splitSqlStatements(`
      -- a leading comment; with a semicolon
      SELECT 1;
      /* block ; comment */
      SELECT 2;
    `);

    assert.deepEqual(statements, ["SELECT 1", "SELECT 2"]);
  });

  test("ignores empty statements from stray semicolons", () => {
    assert.deepEqual(splitSqlStatements(";;SELECT 1;;"), ["SELECT 1"]);
  });

  test("splits the project schema into exactly the two table definitions", async () => {
    const schema = await fs.readFile(path.join(projectRoot, "sql/schema.sql"), "utf8");
    const statements = splitSqlStatements(schema);

    assert.equal(statements.length, 2);
    assert.match(statements[0], /^CREATE TABLE IF NOT EXISTS urls/);
    assert.match(statements[1], /^CREATE TABLE IF NOT EXISTS url_clicks/);
  });
});
