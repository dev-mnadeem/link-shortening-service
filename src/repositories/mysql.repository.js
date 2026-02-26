import {
  QUERIES,
  buildIncrementClickCountsQuery,
  buildInsertClickEventsQuery,
} from "../constants/queries.js";
import { DuplicateShortCodeError } from "../utils/errors.js";

const DUPLICATE_ENTRY_CODE = "ER_DUP_ENTRY";

/**
 * MySQL implementation of the URL repository port.
 *
 * This is the only module that knows about `mysql2`, driver error codes or
 * connection handling. The service layer above it deals in domain errors, so
 * swapping the driver does not ripple upward.
 */
export const createMysqlUrlRepository = ({ pool }) => {
  /**
   * Fixed-shape statements go through `execute` (server-side prepared
   * statements, reused across calls). The batch statements below vary in
   * placeholder count, so they use `query` instead - otherwise every distinct
   * batch size would occupy its own slot in the prepared-statement cache.
   * `query` still binds `?` via the driver's escaper, so the statements remain
   * injection-safe.
   */
  const execute = async (sql, params = []) => {
    const [result] = await pool.execute(sql, params);
    return result;
  };

  return {
    driver: "mysql",

    async findByShortCode(shortCode) {
      const rows = await execute(QUERIES.FIND_URL_BY_SHORT_CODE, [shortCode]);
      return rows.length > 0 ? rows[0] : null;
    },

    async insertUrl({ shortCode, originalUrl }) {
      try {
        const result = await execute(QUERIES.INSERT_URL_MAPPING, [shortCode, originalUrl]);
        return result.insertId;
      } catch (error) {
        if (error?.code === DUPLICATE_ENTRY_CODE) {
          throw new DuplicateShortCodeError(shortCode);
        }

        throw error;
      }
    },

    /**
     * Persists a batch of clicks: one multi-row INSERT plus one grouped
     * UPDATE, inside a single transaction so the event log and the counter
     * cannot drift apart.
     */
    async recordClicks(clickEvents) {
      if (clickEvents.length === 0) {
        return 0;
      }

      const countsByUrlId = new Map();

      for (const clickEvent of clickEvents) {
        countsByUrlId.set(clickEvent.urlId, (countsByUrlId.get(clickEvent.urlId) ?? 0) + 1);
      }

      const insertQuery = buildInsertClickEventsQuery(clickEvents);
      const updateQuery = buildIncrementClickCountsQuery(countsByUrlId);
      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction();
        await connection.query(insertQuery.sql, insertQuery.params);
        await connection.query(updateQuery.sql, updateQuery.params);
        await connection.commit();
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }

      return clickEvents.length;
    },

    async ping() {
      await execute(QUERIES.HEALTHCHECK);
      return true;
    },

    async close() {
      await pool.end();
    },
  };
};
