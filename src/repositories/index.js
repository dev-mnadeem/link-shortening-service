import { createMysqlPool } from "../config/db.js";
import { createMemoryUrlRepository } from "./memory.repository.js";
import { createMysqlUrlRepository } from "./mysql.repository.js";

/**
 * Storage registry - the extension seam.
 *
 * A repository is any object implementing the port below. To add Postgres or
 * Redis, write one module and register it here; nothing above the repository
 * layer changes.
 *
 * @typedef {object} UrlRepository
 * @property {string} driver
 * @property {(shortCode: string) => Promise<object|null>} findByShortCode
 * @property {(input: {shortCode: string, originalUrl: string}) => Promise<number>} insertUrl
 *           Rejects with `DuplicateShortCodeError` on short-code collision.
 * @property {(clickEvents: object[]) => Promise<number>} recordClicks
 * @property {() => Promise<boolean>} ping
 * @property {() => Promise<void>} close
 */
const REPOSITORY_FACTORIES = {
  mysql: (config) => createMysqlUrlRepository({ pool: createMysqlPool(config.db) }),
  memory: () => createMemoryUrlRepository(),
};

export const registerRepositoryDriver = (name, factory) => {
  REPOSITORY_FACTORIES[name] = factory;
};

export const createUrlRepository = (config) => {
  const factory = REPOSITORY_FACTORIES[config.storage.driver];

  if (!factory) {
    throw new Error(
      `Unknown storage driver "${config.storage.driver}". Known drivers: ${Object.keys(
        REPOSITORY_FACTORIES,
      ).join(", ")}.`,
    );
  }

  return factory(config);
};
