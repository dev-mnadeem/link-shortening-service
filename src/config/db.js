import mysql from "mysql2/promise";

/**
 * Creates the MySQL connection pool.
 *
 * `queueLimit: 0` means an unbounded wait queue, which turns pool exhaustion
 * into unbounded latency instead of a fast failure; the limit below makes the
 * service shed load once the backlog is clearly beyond the pool's throughput.
 */
export const createMysqlPool = (dbConfig) =>
  mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    connectionLimit: dbConfig.connectionLimit,
    waitForConnections: true,
    queueLimit: dbConfig.connectionLimit * 20,
    enableKeepAlive: true,
    namedPlaceholders: false,
  });
