# URL Shortener Service

A small bit.ly style URL shortener. `POST /shorten` stores a long URL under a generated code and `GET /:code` redirects to it and records the click. It's written with Node.js 22, Express 5 and MySQL using plain SQL (no ORM or query builder).

## How it works

- Codes are 8 base62 characters generated with `crypto.randomInt`.
- Collisions are caught by the unique index on `urls.short_code`. On a duplicate key error the service generates a new code and retries, up to `SHORT_CODE_MAX_ATTEMPTS` times.
- Redirect lookups go through an in-memory LRU cache. Misses are cached briefly too, so requests for codes that don't exist don't each hit the database.
- Clicks are buffered in memory and written in batches inside one transaction. This means `click_count` can lag by about `CLICK_FLUSH_MS`, and a hard kill can lose the current buffer. On SIGTERM the buffer is flushed.
- Per-client rate limits, with separate budgets for creating links and for redirects.

The schema is in [sql/schema.sql](sql/schema.sql): a `urls` table and a `url_clicks` table with one row per redirect.

## Running locally

```bash
npm install
cp .env.example .env   # set your MySQL credentials
npm run db:init        # creates the database and tables
npm run dev            # http://localhost:3000
```

If you don't have MySQL handy, `STORAGE_DRIVER=memory npm start` runs the service with an in-memory store instead. Data is lost when the process stops.

You can also use Docker Compose, which starts MySQL, runs the schema script once and then starts the app on port 3000:

```bash
docker compose up --build
```

## Using it

```bash
curl -X POST http://localhost:3000/shorten \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/a/long/path"}'

curl -i http://localhost:3000/<code>
```

| Method | Path | Response |
| --- | --- | --- |
| POST | `/shorten` | 201 with `shortUrl` and `code` |
| GET | `/:code` | 302 redirect |
| GET | `/healthz` | 200 |
| GET | `/readyz` | 200, or 503 if storage is down |

Errors use one shape: `{"error": {"code", "message", "details"}}`. URLs must be `http` or `https` and at most 2048 characters.

All config lives in `.env.example`. The ones you're most likely to touch are `STORAGE_DRIVER`, `CACHE_TTL_MS`, `CLICK_FLUSH_MS`, `CLICK_IP_MODE` (`full`, `anonymized` or `none`) and `TRUST_PROXY`.

More detail, including example requests and responses, is in [docs/api-walkthrough.md](docs/api-walkthrough.md) and [docs/performance.md](docs/performance.md).

## Tests

```bash
npm test          # unit and HTTP tests, uses the in-memory driver
npm run lint
```

The MySQL repository has its own integration tests that run against a real server:

```bash
TEST_MYSQL=1 DB_NAME=url_shortener_test npm run test:mysql
```

## Next steps

- The cache and rate limiter are per process. Running more than one instance would need a shared store like Redis.
- There's no auth, no custom aliases and no endpoint to read click stats back.
