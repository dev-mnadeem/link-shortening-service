# Captured API walkthrough

Every block below is verbatim output from a real run — nothing here is
illustrative. Captured on 2026-09-24 against:

- Node.js v22.22.3
- MySQL 9.3.0 (a throwaway server on `127.0.0.1:8526`)
- the service on `http://localhost:8520`, schema applied with `npm run db:init`
- default configuration except `PORT`, `BASE_URL`, `DB_PORT`, `DB_NAME`,
  `CLICK_FLUSH_MS=200` and `CLICK_BATCH_SIZE=25`

```console
### 1. Health probes
$ curl -s http://localhost:8520/healthz
{"status":"ok"}
$ curl -s http://localhost:8520/readyz
{"status":"ready","storage":"mysql"}
### 2. Create a short URL
$ curl -s -i -X POST http://localhost:8520/shorten -H 'Content-Type: application/json' -d '{"url": "https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/302"}'
HTTP/1.1 201 Created
RateLimit-Limit: 10
RateLimit-Remaining: 9
RateLimit-Reset: 1790261458
Content-Type: application/json; charset=utf-8
Content-Length: 140
ETag: W/"8c-qPfuYTnySxDQ3sJRWLaVk7rV0ek"
Date: Thu, 24 Sep 2026 14:49:57 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"shortUrl":"http://localhost:8520/tiOUXxgG","code":"tiOUXxgG","originalUrl":"https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/302"}
### 3. Follow the short URL (code Ew0cl88Y created by a second POST)
$ curl -s -o /dev/null -D - http://localhost:8520/Ew0cl88Y
HTTP/1.1 302 Found
RateLimit-Limit: 600
RateLimit-Remaining: 599
RateLimit-Reset: 1790261458
Cache-Control: private, no-store
Location: https://www.postgresql.org/docs/current/indexes-types.html
Vary: Accept
Content-Type: text/plain; charset=utf-8
Content-Length: 80
Date: Thu, 24 Sep 2026 14:49:57 GMT
Connection: keep-alive
Keep-Alive: timeout=5


### 4. Errors
$ curl -s http://localhost:8520/zzzzzzzz
{"error":{"code":"NOT_FOUND","message":"Short URL not found.","details":null}}
$ curl -s -X POST http://localhost:8520/shorten -H 'Content-Type: application/json' -d '{"url": "javascript:alert(document.cookie)"}'
{"error":{"code":"VALIDATION_ERROR","message":"Only http and https URLs are supported.","details":{"allowedProtocols":["http:","https:"]}}}
$ curl -s -X POST http://localhost:8520/shorten -H 'Content-Type: application/json' -d '{}'
{"error":{"code":"VALIDATION_ERROR","message":"The `url` field is required and must be a string.","details":null}}
$ curl -s -X POST http://localhost:8520/shorten -H 'Content-Type: application/json' -d '{not json'
{"error":{"code":"BAD_REQUEST","message":"Malformed request body.","details":null}}
$ curl -s -X PUT http://localhost:8520/shorten
{"error":{"code":"NOT_FOUND","message":"Route not found.","details":null}}
### 5. What landed in MySQL
$ mysql --protocol=TCP -h 127.0.0.1 -P 8526 -u root url_shortener_demo -e 'SELECT id, short_code, LEFT(original_url,46) AS original_url, click_count, created_at FROM urls ORDER BY id;'
id	short_code	original_url	click_count	created_at
1	tiOUXxgG	https://developer.mozilla.org/en-US/docs/Web/H	0	2026-09-24 19:49:57
2	Ew0cl88Y	https://www.postgresql.org/docs/current/indexe	3	2026-09-24 19:49:57

$ mysql --protocol=TCP -h 127.0.0.1 -P 8526 -u root url_shortener_demo -e 'SELECT url_id, clicked_at, ip_address, user_agent FROM url_clicks ORDER BY id;'
url_id	clicked_at	ip_address	user_agent
2	2026-09-24 19:49:57	::1	curl/8.7.1
2	2026-09-24 19:49:57	::1	curl/8.7.1
2	2026-09-24 19:49:57	::1	curl/8.7.1

### 6. Rate limiting on the write endpoint (RATE_LIMIT_MAX_REQUESTS=10)
$ for i in $(seq 1 12); do curl -s -o /dev/null -w "POST /shorten #$i -> %{http_code}\n" -X POST http://localhost:8520/shorten -H "Content-Type: application/json" -d "{"url":"https://example.com/burst/$i"}"; done
POST /shorten #1 -> 201
POST /shorten #2 -> 201
POST /shorten #3 -> 201
POST /shorten #4 -> 201
POST /shorten #5 -> 201
POST /shorten #6 -> 201
POST /shorten #7 -> 429
POST /shorten #8 -> 429
POST /shorten #9 -> 429
POST /shorten #10 -> 429
POST /shorten #11 -> 429
POST /shorten #12 -> 429

$ curl -s -i -X POST http://localhost:8520/shorten -H 'Content-Type: application/json' -d '{"url":"https://example.com/after-the-limit"}'
HTTP/1.1 429 Too Many Requests
RateLimit-Limit: 10
RateLimit-Remaining: 0
RateLimit-Reset: 1790261458
Retry-After: 58
Content-Type: application/json; charset=utf-8
Content-Length: 136
ETag: W/"88-koJHSmotEjzwUmM66joylLI+q4s"
Date: Thu, 24 Sep 2026 14:49:59 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"RATE_LIMIT_EXCEEDED","message":"Rate limit exceeded.","details":{"retryAfterSeconds":58,"limit":10,"windowMs":60000}}}
### 7. The redirect path keeps its own, larger budget
$ curl -s -o /dev/null -w 'GET /Ew0cl88Y -> %{http_code}
' http://localhost:8520/Ew0cl88Y
GET /Ew0cl88Y -> 302

```

> In section 6, six requests succeed rather than ten: four of the window's ten
> writes had already been spent by sections 2 and 4 of this same transcript.

## Server log for the same run

The application logs one structured line per request. Note what is *not* in
them — no client IP, no user-agent, no body. Those are click-analytics fields
with a defined home in `url_clicks`; copying them into application logs would
scatter personal data into a store with no retention policy.

```console
$ tail -f server.log   # (first 20 lines of the run above)
{"level":"info","time":"2026-09-24T14:49:54.157Z","message":"Server listening.","port":8520,"storage":"mysql","env":"development"}
{"level":"info","time":"2026-09-24T14:49:57.063Z","message":"request","method":"GET","route":"/healthz","status":200,"durationMs":4.48}
{"level":"info","time":"2026-09-24T14:49:57.094Z","message":"request","method":"GET","route":"/readyz","status":200,"durationMs":14.09}
{"level":"info","time":"2026-09-24T14:49:57.115Z","message":"request","method":"POST","route":"/shorten","status":201,"durationMs":7.08}
{"level":"info","time":"2026-09-24T14:49:57.130Z","message":"request","method":"POST","route":"/shorten","status":201,"durationMs":1.47}
{"level":"info","time":"2026-09-24T14:49:57.191Z","message":"request","method":"GET","route":"/:shortUrl","status":302,"durationMs":2.44}
{"level":"info","time":"2026-09-24T14:49:57.200Z","message":"request","method":"GET","route":"/:shortUrl","status":302,"durationMs":0.42}
{"level":"info","time":"2026-09-24T14:49:57.209Z","message":"request","method":"GET","route":"/:shortUrl","status":302,"durationMs":0.32}
{"level":"info","time":"2026-09-24T14:49:57.219Z","message":"request","method":"GET","route":"/:shortUrl","status":404,"durationMs":0.98}
{"level":"info","time":"2026-09-24T14:49:57.229Z","message":"request","method":"POST","route":"/shorten","status":400,"durationMs":0.87}
{"level":"info","time":"2026-09-24T14:49:57.238Z","message":"request","method":"POST","route":"/shorten","status":400,"durationMs":0.38}
{"level":"info","time":"2026-09-24T14:49:57.247Z","message":"request","method":"POST","route":"/shorten","status":400,"durationMs":0.72}
{"level":"info","time":"2026-09-24T14:49:57.259Z","message":"request","method":"PUT","route":"/shorten","status":404,"durationMs":0.5}
{"level":"info","time":"2026-09-24T14:49:59.391Z","message":"request","method":"POST","route":"/shorten","status":201,"durationMs":1.46}
{"level":"info","time":"2026-09-24T14:49:59.403Z","message":"request","method":"POST","route":"/shorten","status":201,"durationMs":1.31}
{"level":"info","time":"2026-09-24T14:49:59.415Z","message":"request","method":"POST","route":"/shorten","status":201,"durationMs":1.41}
{"level":"info","time":"2026-09-24T14:49:59.427Z","message":"request","method":"POST","route":"/shorten","status":201,"durationMs":2}
{"level":"info","time":"2026-09-24T14:49:59.441Z","message":"request","method":"POST","route":"/shorten","status":201,"durationMs":1.46}
{"level":"info","time":"2026-09-24T14:49:59.457Z","message":"request","method":"POST","route":"/shorten","status":201,"durationMs":1.11}
{"level":"info","time":"2026-09-24T14:49:59.468Z","message":"request","method":"POST","route":"/shorten","status":429,"durationMs":0.46}
```
