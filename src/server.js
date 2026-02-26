import { loadConfig } from "./config/env.js";
import { createContainer } from "./container.js";

const config = loadConfig();
const container = createContainer(config);
const { app, logger } = container;

container.start();

const server = app.listen(config.app.port, () => {
  logger.info("Server listening.", {
    port: server.address().port,
    storage: config.storage.driver,
    env: config.app.env,
  });
});

let shuttingDown = false;

/**
 * Orderly shutdown: stop accepting connections, flush buffered analytics,
 * close the pool. The timeout is the backstop - a keep-alive connection that
 * never closes must not hold the process open forever.
 */
const shutdown = async (signal) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info("Shutting down.", { signal });

  const forceExit = setTimeout(() => {
    logger.error("Shutdown timed out; exiting.", { timeoutMs: config.app.shutdownTimeoutMs });
    process.exit(1);
  }, config.app.shutdownTimeoutMs);

  forceExit.unref();

  server.close(async () => {
    try {
      await container.stop();
      logger.info("Shutdown complete.");
      process.exit(0);
    } catch (error) {
      logger.error("Shutdown failed.", { reason: error.message });
      process.exit(1);
    }
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection.", {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception; shutting down.", { reason: error.message, stack: error.stack });
  shutdown("uncaughtException");
});
