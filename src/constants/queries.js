/**
 * Every SQL statement the service runs. Raw SQL was a requirement of the
 * brief, so it is collected here rather than inlined at call sites: one file
 * to review for injection risk, and one file to diff against `sql/schema.sql`.
 *
 * All user-supplied values are bound as `?` placeholders. The two builders
 * below assemble placeholder *lists* only - never a value - so a batch stays
 * as safe as a single-row statement.
 */
export const QUERIES = {
  FIND_URL_BY_SHORT_CODE: `
    SELECT id, short_code, original_url, click_count, created_at
    FROM urls
    WHERE short_code = ?
    LIMIT 1
  `,
  INSERT_URL_MAPPING: `
    INSERT INTO urls (short_code, original_url)
    VALUES (?, ?)
  `,
  HEALTHCHECK: "SELECT 1 AS ok",
};

/**
 * Builds a single multi-row INSERT for a batch of click events.
 *
 * One statement per batch instead of one per redirect: at 50 clicks per flush
 * that is 50 round trips collapsed into 1.
 */
export const buildInsertClickEventsQuery = (clickEvents) => {
  if (clickEvents.length === 0) {
    throw new RangeError("Cannot build an insert for an empty click batch.");
  }

  const valuesSql = clickEvents.map(() => "(?, ?, ?, ?)").join(", ");
  const params = clickEvents.flatMap((clickEvent) => [
    clickEvent.urlId,
    clickEvent.ipAddress,
    clickEvent.userAgent,
    clickEvent.clickedAt,
  ]);

  return {
    sql: `INSERT INTO url_clicks (url_id, ip_address, user_agent, clicked_at) VALUES ${valuesSql}`,
    params,
  };
};

/**
 * Builds one UPDATE that applies a different increment to each url row.
 *
 * The alternative - `UPDATE ... SET click_count = click_count + 1` once per
 * redirect - serialises every concurrent hit on a popular link behind the same
 * row lock. Folding a batch into a single statement holds that lock once.
 */
export const buildIncrementClickCountsQuery = (countsByUrlId) => {
  const urlIds = [...countsByUrlId.keys()];

  if (urlIds.length === 0) {
    throw new RangeError("Cannot build an update for an empty count map.");
  }

  const caseSql = urlIds.map(() => "WHEN ? THEN ?").join(" ");
  const inSql = urlIds.map(() => "?").join(", ");
  const params = [...urlIds.flatMap((urlId) => [urlId, countsByUrlId.get(urlId)]), ...urlIds];

  return {
    sql: `
    UPDATE urls
    SET click_count = click_count + CASE id ${caseSql} ELSE 0 END
    WHERE id IN (${inSql})
  `,
    params,
  };
};
