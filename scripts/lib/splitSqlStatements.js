/**
 * Splits a SQL file into individual statements.
 *
 * `mysql2` runs one statement per call unless `multipleStatements` is enabled,
 * and enabling that on a connection is exactly the setting that turns a single
 * injection into an arbitrary script. So the file is split client-side
 * instead, honouring quoting and comments so that a `;` inside a string
 * literal or a `-- comment` does not split a statement in half.
 *
 * Extracted from the init script so it can be unit tested without a database.
 */
export const splitSqlStatements = (sqlContent) => {
  const statements = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sqlContent.length; index += 1) {
    const char = sqlContent[index];
    const nextChar = sqlContent[index + 1] || "";

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
      if (char === "-" && nextChar === "-") {
        inLineComment = true;
        index += 1;
        continue;
      }

      if (char === "/" && nextChar === "*") {
        inBlockComment = true;
        index += 1;
        continue;
      }
    }

    if (char === "'" && !inDoubleQuote && !inBacktick) {
      if ((sqlContent[index - 1] || "") !== "\\") {
        inSingleQuote = !inSingleQuote;
      }
    } else if (char === '"' && !inSingleQuote && !inBacktick) {
      if ((sqlContent[index - 1] || "") !== "\\") {
        inDoubleQuote = !inDoubleQuote;
      }
    } else if (char === "`" && !inSingleQuote && !inDoubleQuote) {
      inBacktick = !inBacktick;
    }

    if (char === ";" && !inSingleQuote && !inDoubleQuote && !inBacktick) {
      const statement = current.trim();

      if (statement.length > 0) {
        statements.push(statement);
      }

      current = "";
      continue;
    }

    current += char;
  }

  const remainingStatement = current.trim();

  if (remainingStatement.length > 0) {
    statements.push(remainingStatement);
  }

  return statements;
};
