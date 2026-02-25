/**
 * Redirect-path load probe.
 *
 * Fires `BENCH_REQUESTS` GETs at a short URL with `BENCH_CONCURRENCY` workers
 * and reports latency percentiles. Used to compare the redirect path with and
 * without the read-through cache; the numbers quoted in the README came from
 * this script.
 *
 *   BENCH_URL=http://localhost:8520/AbC12xyZ node scripts/bench-redirect.js
 */
const url = process.env.BENCH_URL;
const totalRequests = Number(process.env.BENCH_REQUESTS || 2000);
const concurrency = Number(process.env.BENCH_CONCURRENCY || 20);
const label = process.env.BENCH_LABEL || "redirect";

if (!url) {
  console.error("BENCH_URL is required.");
  process.exit(1);
}

const percentile = (sortedValues, fraction) =>
  sortedValues[Math.min(sortedValues.length - 1, Math.floor(sortedValues.length * fraction))];

const run = async () => {
  const latencies = [];
  const statusCounts = new Map();
  let issued = 0;

  const worker = async () => {
    while (issued < totalRequests) {
      issued += 1;
      const startedAt = process.hrtime.bigint();
      const response = await fetch(url, { redirect: "manual" });
      await response.arrayBuffer();
      latencies.push(Number(process.hrtime.bigint() - startedAt) / 1e6);
      statusCounts.set(response.status, (statusCounts.get(response.status) ?? 0) + 1);
    }
  };

  const startedAt = process.hrtime.bigint();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  latencies.sort((a, b) => a - b);

  const format = (value) => value.toFixed(2);

  console.log(
    [
      `label=${label}`,
      `requests=${latencies.length}`,
      `concurrency=${concurrency}`,
      `statuses=${[...statusCounts].map(([status, count]) => `${status}:${count}`).join(",")}`,
      `elapsed_ms=${format(elapsedMs)}`,
      `rps=${format((latencies.length / elapsedMs) * 1000)}`,
      `p50_ms=${format(percentile(latencies, 0.5))}`,
      `p95_ms=${format(percentile(latencies, 0.95))}`,
      `p99_ms=${format(percentile(latencies, 0.99))}`,
    ].join(" "),
  );
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
