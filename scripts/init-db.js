import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { loadConfig } from "../src/config/env.js";
import { splitSqlStatements } from "./lib/splitSqlStatements.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, "../sql/schema.sql");

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_$]+$/;

/**
 * Database names cannot be bound as `?` placeholders, so the only safe option
 * is to refuse anything that is not a plain identifier.
 */
const quoteIdentifier = (identifier) => {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Refusing to use unsafe database name: ${identifier}`);
  }

  return `\`${identifier}\``;
};

const run = async () => {
  const { db } = loadConfig();
  const schemaFileContent = await fs.readFile(schemaPath, "utf8");
  const statements = splitSqlStatements(schemaFileContent);

  if (statements.length === 0) {
    throw new Error("No SQL statements found in schema file.");
  }

  const connection = await mysql.createConnection({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    multipleStatements: false,
  });

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(db.database)}`);
    await connection.query(`USE ${quoteIdentifier(db.database)}`);

    for (const statement of statements) {
      await connection.query(statement);
    }
  } finally {
    await connection.end();
  }

  console.log(
    `Database "${db.database}" initialized. Executed ${statements.length} SQL statements.`,
  );
};

run().catch((error) => {
  console.error("Database initialization failed.");
  console.error(error.message);
  process.exitCode = 1;
});
