import { silentLogger } from "../lib/logger.js";

/**
 * Buffers click events and writes them in batches.
 *
 * The original implementation did `SELECT`, `BEGIN`, `UPDATE`, `INSERT`,
 * `COMMIT` inline on every redirect, so a visitor waited on four round trips
 * and a row lock before receiving a `302`. Analytics are not what the visitor
 * is waiting for, so they move off the hot path: `record()` is synchronous and
 * in-process, and a flush drains the buffer in one transaction.
 *
 * The trade-off is explicit: click counts become eventually consistent within
 * `flushIntervalMs`, and a hard process kill can lose at most one buffer.
 * `close()` flushes, so an orderly shutdown loses nothing.
 */
export const createClickRecorder = ({
  repository,
  batchSize = 50,
  flushIntervalMs = 1_000,
  maxQueueSize = 10_000,
  logger = silentLogger,
}) => {
  let buffer = [];
  let flushTimer = null;
  let inFlight = null;
  let droppedEvents = 0;
  let flushedEvents = 0;
  let failedFlushes = 0;

  const flush = async () => {
    if (buffer.length === 0) {
      return 0;
    }

    const batch = buffer;
    buffer = [];

    try {
      await repository.recordClicks(batch);
      flushedEvents += batch.length;
      return batch.length;
    } catch (error) {
      failedFlushes += 1;
      // Analytics must never take the redirect path down with them, so a
      // failed batch is logged and dropped rather than retried forever.
      logger.error("Failed to persist click batch.", {
        batchSize: batch.length,
        reason: error.message,
      });
      return 0;
    }
  };

  /** Serialises flushes so two batches never interleave on the same pool. */
  const scheduleFlush = () => {
    inFlight = (inFlight ?? Promise.resolve()).then(flush, flush);
    return inFlight;
  };

  return {
    record(clickEvent) {
      if (buffer.length >= maxQueueSize) {
        droppedEvents += 1;

        if (droppedEvents === 1 || droppedEvents % 1_000 === 0) {
          logger.warn("Click buffer full; dropping analytics events.", { droppedEvents });
        }

        return false;
      }

      buffer.push(clickEvent);

      if (buffer.length >= batchSize) {
        scheduleFlush();
      }

      return true;
    },

    start() {
      if (flushTimer !== null || flushIntervalMs <= 0) {
        return;
      }

      flushTimer = setInterval(scheduleFlush, flushIntervalMs);
      // Do not hold the event loop open just to flush analytics.
      flushTimer.unref?.();
    },

    async flush() {
      return scheduleFlush();
    },

    async close() {
      if (flushTimer !== null) {
        clearInterval(flushTimer);
        flushTimer = null;
      }

      await scheduleFlush();
      await inFlight;
    },

    stats() {
      return { buffered: buffer.length, flushedEvents, droppedEvents, failedFlushes };
    },
  };
};
