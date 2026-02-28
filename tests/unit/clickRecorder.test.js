import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createClickRecorder } from "../../src/services/clickRecorder.js";

const createStubRepository = ({ failTimes = 0 } = {}) => {
  const batches = [];
  let remainingFailures = failTimes;

  return {
    batches,
    async recordClicks(batch) {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error("write failed");
      }

      batches.push(batch);
      return batch.length;
    },
  };
};

const clickFor = (urlId) => ({
  urlId,
  ipAddress: "203.0.113.1",
  userAgent: "test",
  clickedAt: new Date(),
});

describe("createClickRecorder", () => {
  test("buffers clicks without writing until the batch size is reached", async () => {
    const repository = createStubRepository();
    const recorder = createClickRecorder({ repository, batchSize: 3, flushIntervalMs: 0 });

    recorder.record(clickFor(1));
    recorder.record(clickFor(1));

    assert.equal(repository.batches.length, 0);
    assert.equal(recorder.stats().buffered, 2);

    recorder.record(clickFor(2));
    await recorder.flush();

    assert.equal(repository.batches.length, 1);
    assert.equal(repository.batches[0].length, 3);
  });

  test("flushes on demand and reports what it wrote", async () => {
    const repository = createStubRepository();
    const recorder = createClickRecorder({ repository, batchSize: 100, flushIntervalMs: 0 });

    recorder.record(clickFor(7));
    await recorder.flush();

    assert.deepEqual(
      repository.batches[0].map((event) => event.urlId),
      [7],
    );
    assert.equal(recorder.stats().flushedEvents, 1);
  });

  test("flushing an empty buffer is a no-op", async () => {
    const repository = createStubRepository();
    const recorder = createClickRecorder({ repository, batchSize: 10, flushIntervalMs: 0 });

    await recorder.flush();

    assert.equal(repository.batches.length, 0);
  });

  test("a failed batch is counted and dropped rather than rethrown", async () => {
    const repository = createStubRepository({ failTimes: 1 });
    const recorder = createClickRecorder({ repository, batchSize: 10, flushIntervalMs: 0 });

    recorder.record(clickFor(1));
    await recorder.flush();

    assert.equal(recorder.stats().failedFlushes, 1);
    assert.equal(recorder.stats().buffered, 0);

    recorder.record(clickFor(2));
    await recorder.flush();

    assert.equal(repository.batches.length, 1);
  });

  test("drops events once the queue cap is hit instead of growing without bound", async () => {
    const repository = createStubRepository();
    const recorder = createClickRecorder({
      repository,
      batchSize: 1_000,
      flushIntervalMs: 0,
      maxQueueSize: 2,
    });

    assert.equal(recorder.record(clickFor(1)), true);
    assert.equal(recorder.record(clickFor(1)), true);
    assert.equal(recorder.record(clickFor(1)), false);

    assert.equal(recorder.stats().buffered, 2);
    assert.equal(recorder.stats().droppedEvents, 1);
  });

  test("close flushes what is buffered so an orderly shutdown loses nothing", async () => {
    const repository = createStubRepository();
    const recorder = createClickRecorder({ repository, batchSize: 1_000, flushIntervalMs: 5 });

    recorder.start();
    recorder.record(clickFor(42));
    await recorder.close();

    assert.equal(repository.batches.length, 1);
    assert.equal(repository.batches[0][0].urlId, 42);
  });

  test("the interval timer flushes buffered clicks on its own", async () => {
    const repository = createStubRepository();
    const recorder = createClickRecorder({ repository, batchSize: 1_000, flushIntervalMs: 5 });

    recorder.start();
    recorder.record(clickFor(3));

    await new Promise((resolve) => setTimeout(resolve, 40));

    assert.equal(repository.batches.length, 1);
    await recorder.close();
  });
});
