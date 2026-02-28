import { once } from "node:events";
import { loadConfig } from "../../src/config/env.js";
import { createContainer } from "../../src/container.js";
import { createMemoryUrlRepository } from "../../src/repositories/memory.repository.js";

/**
 * Boots the real application - real routes, real middleware, real service -
 * against the in-memory repository on an ephemeral port.
 *
 * Nothing is stubbed except storage, so these tests exercise the same stack a
 * request hits in production.
 */
export const startTestApp = async (env = {}) => {
  const config = loadConfig({
    NODE_ENV: "test",
    PORT: "0",
    BASE_URL: "http://127.0.0.1",
    LOG_LEVEL: "silent",
    STORAGE_DRIVER: "memory",
    CLICK_BATCH_SIZE: "1",
    CLICK_FLUSH_MS: "0",
    ...env,
  });

  const repository = createMemoryUrlRepository();
  const container = createContainer(config, { repository });

  container.start();

  const server = container.app.listen(0);
  await once(server, "listening");

  const { port } = server.address();

  return {
    container,
    repository,
    baseUrl: `http://127.0.0.1:${port}`,

    /** Convenience wrapper: never auto-follow, so 302s stay assertable. */
    async request(path, options = {}) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        redirect: "manual",
        ...options,
      });

      const text = await response.text();
      let body = null;

      try {
        body = text === "" ? null : JSON.parse(text);
      } catch {
        body = text;
      }

      return { status: response.status, headers: response.headers, body };
    },

    async shorten(url) {
      return this.request("/shorten", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
    },

    async close() {
      server.close();
      await once(server, "close");
      await container.stop();
    },
  };
};
