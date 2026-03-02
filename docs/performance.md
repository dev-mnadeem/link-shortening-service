# Measured: what the redirect path costs

All numbers below come from `scripts/bench-redirect.js` run against the
service on `http://localhost:8520`, backed by a real MySQL 9.3.0 server on
`127.0.0.1:8526`, on an Apple Silicon laptop, Node.js v22.22.3, on 2026-09-24.
Statement counts are deltas of `SHOW GLOBAL STATUS` (`Com_select`,
`Com_insert`, `Com_update`, `Com_commit`) taken immediately before and after
each run.

Both the load generator and the service ran on the same machine, so the
absolute latencies are optimistic and the throughput ceiling is partly the
Node.js `fetch` client, not the server. The *statement counts* are the
meaningful figures: they are exactly what the cache and the batching writer
were built to change, and they are independent of the client.

## A. Read path — 500 sequential redirects of one short code

```console
$ BENCH_URL=http://localhost:8520/<code> BENCH_REQUESTS=500 BENCH_CONCURRENCY=1 \
    node scripts/bench-redirect.js

label=cache-5min-ttl requests=500 concurrency=1 statuses=302:500 elapsed_ms=199.63 rps=2504.63 p50_ms=0.28 p95_ms=0.69 p99_ms=1.26
  statements issued to MySQL for 500 redirects: Com_commit=21  Com_insert=21  Com_select=2  Com_update=21

label=cache-1ms-ttl-baseline requests=500 concurrency=1 statuses=302:500 elapsed_ms=234.66 rps=2130.72 p50_ms=0.34 p95_ms=0.87 p99_ms=1.59
  statements issued to MySQL for 500 redirects: Com_commit=21  Com_insert=21  Com_select=199  Com_update=21
```

**500 redirects cost 2 `SELECT`s instead of 199.**

Caveat, stated plainly: the baseline is `CACHE_TTL_MS=1`, not a build with the
cache removed, because there is no switch to remove it. At ~0.3 ms per request
roughly two requests still share each 1 ms window, which is why the baseline
reads 199 rather than 500. A true no-cache build would issue one `SELECT` per
redirect — 500. Either way the cache absorbs essentially all of the read load
for a hot link.

The latency difference (p50 0.34 ms → 0.28 ms) is small because MySQL is on
loopback here. The figure that travels to production is the query count: on a
real deployment the saved round trip is a network hop and a connection from a
pool sized in the tens.

## B. Write path — 3000 concurrent redirects

```console
$ BENCH_URL=http://localhost:8520/<code> BENCH_REQUESTS=3000 BENCH_CONCURRENCY=20 \
    node scripts/bench-redirect.js     # CLICK_BATCH_SIZE=50 CLICK_FLUSH_MS=1000

label=batched-clicks requests=3000 concurrency=20 statuses=302:3000 elapsed_ms=404.01 rps=7425.58 p50_ms=2.02 p95_ms=4.70 p99_ms=7.63
  statements issued to MySQL for 3000 redirects: Com_commit=62  Com_insert=62  Com_select=12  Com_update=62
```

**3000 redirects cost 62 `INSERT`s, 62 `UPDATE`s and 62 transactions.**

The original implementation ran `SELECT` → `BEGIN` → `UPDATE` → `INSERT` →
`COMMIT` inline on every single redirect. That is 3000 of each, by construction
— that figure is read off the code path, not measured, because reverting the
service to measure it was not worth the churn. The reduction in write
statements is therefore ~48x, and the visitor no longer waits on any of it: the
`302` is returned as soon as the destination is known.

The cost of that trade is stated in the README's limitations: `click_count` is
eventually consistent within `CLICK_FLUSH_MS`, and a `SIGKILL` can lose at most
one buffer of clicks. `SIGTERM` flushes before exit.

## Reproducing

```bash
npm run db:init
PORT=8520 node src/server.js &
CODE=$(curl -s -X POST http://localhost:8520/shorten \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/bench"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["code"])')
BENCH_URL="http://localhost:8520/$CODE" BENCH_REQUESTS=3000 BENCH_CONCURRENCY=20 \
  node scripts/bench-redirect.js
```

Raise `REDIRECT_RATE_LIMIT_MAX_REQUESTS` first, or the run will measure the
rate limiter.
