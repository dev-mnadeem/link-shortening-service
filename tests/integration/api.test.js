import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";
import { startTestApp } from "../helpers/testApp.js";

describe("POST /shorten", () => {
  let app;

  before(async () => {
    app = await startTestApp();
  });

  after(async () => {
    await app.close();
  });

  test("creates a short URL", async () => {
    const response = await app.shorten("https://example.com/a/very/long/path?with=query");

    assert.equal(response.status, 201);
    assert.match(response.body.code, /^[A-Za-z0-9]{8}$/);
    assert.equal(response.body.shortUrl, `http://127.0.0.1/${response.body.code}`);
    assert.equal(response.body.originalUrl, "https://example.com/a/very/long/path?with=query");
  });

  test("issues a distinct code per request", async () => {
    const first = await app.shorten("https://example.com/one");
    const second = await app.shorten("https://example.com/two");

    assert.notEqual(first.body.code, second.body.code);
  });

  test("rejects a missing url with a 400 and a machine-readable code", async () => {
    const response = await app.request("/shorten", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "VALIDATION_ERROR");
  });

  test("rejects a non-http protocol", async () => {
    const response = await app.shorten("javascript:alert(document.cookie)");

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "VALIDATION_ERROR");
  });

  test("answers malformed JSON with a 400, not a 500", async () => {
    const response = await app.request("/shorten", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "BAD_REQUEST");
  });

  test("rejects an oversized body with a 413 before parsing it", async () => {
    const response = await app.request("/shorten", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: `https://example.com/${"a".repeat(20_000)}` }),
    });

    assert.equal(response.status, 413);
    assert.equal(response.body.error.code, "PAYLOAD_TOO_LARGE");
  });

  test("does not advertise the server framework", async () => {
    const response = await app.shorten("https://example.com/header-check");
    assert.equal(response.headers.get("x-powered-by"), null);
  });
});

describe("GET /:shortUrl", () => {
  let app;

  before(async () => {
    app = await startTestApp();
  });

  after(async () => {
    await app.close();
  });

  test("redirects to the original URL with a 302", async () => {
    const created = await app.shorten("https://example.com/destination");
    const response = await app.request(`/${created.body.code}`);

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://example.com/destination");
  });

  test("tells intermediaries not to cache the redirect away", async () => {
    const created = await app.shorten("https://example.com/no-cache");
    const response = await app.request(`/${created.body.code}`);

    assert.match(response.headers.get("cache-control"), /no-store/);
  });

  test("404s an unknown code as JSON", async () => {
    const response = await app.request("/zzzzzzzz");

    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, "NOT_FOUND");
  });

  test("404s a path that could not be a short code", async () => {
    const response = await app.request("/favicon.ico");

    assert.equal(response.status, 404);
  });

  test("404s an unknown method on a known path", async () => {
    const response = await app.request("/shorten", { method: "PUT" });

    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, "NOT_FOUND");
  });

  test("records one click event per redirect", async () => {
    const created = await app.shorten("https://example.com/counted");

    for (let visit = 0; visit < 3; visit += 1) {
      await app.request(`/${created.body.code}`);
    }

    await app.container.clickRecorder.flush();

    const stored = await app.repository.findByShortCode(created.body.code);
    const events = app.repository._debug.clickEvents.filter((event) => event.urlId === stored.id);

    assert.equal(stored.click_count, 3);
    assert.equal(events.length, 3);
    assert.equal(events[0].userAgent.length > 0, true);
  });
});

describe("rate limiting", () => {
  let app;

  before(async () => {
    app = await startTestApp({ RATE_LIMIT_MAX_REQUESTS: "3", RATE_LIMIT_WINDOW_MS: "60000" });
  });

  after(async () => {
    await app.close();
  });

  test("429s the request after the write limit is spent", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const allowed = await app.shorten(`https://example.com/${attempt}`);
      assert.equal(allowed.status, 201, `request ${attempt + 1} should be allowed`);
    }

    const rejected = await app.shorten("https://example.com/over-limit");

    assert.equal(rejected.status, 429);
    assert.equal(rejected.body.error.code, "RATE_LIMIT_EXCEEDED");
    assert.equal(rejected.body.error.details.limit, 3);
    assert.ok(Number(rejected.headers.get("retry-after")) > 0);
  });

  test("the redirect path keeps its own, larger budget", async () => {
    // The write budget above is already exhausted; redirects must still work.
    const response = await app.request("/zzzzzzzz");

    assert.equal(response.status, 404, "redirects are not limited by the write bucket");
  });
});

describe("proxy header handling", () => {
  test("ignores X-Forwarded-For by default so the limiter cannot be bypassed", async () => {
    const app = await startTestApp({ RATE_LIMIT_MAX_REQUESTS: "2" });

    try {
      const send = (forwardedFor) =>
        app.request("/shorten", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": forwardedFor },
          body: JSON.stringify({ url: "https://example.com/spoof" }),
        });

      assert.equal((await send("1.1.1.1")).status, 201);
      assert.equal((await send("2.2.2.2")).status, 201);
      assert.equal((await send("3.3.3.3")).status, 429, "a new XFF must not reset the bucket");
    } finally {
      await app.close();
    }
  });

  test("honours X-Forwarded-For when TRUST_PROXY is enabled", async () => {
    const app = await startTestApp({ RATE_LIMIT_MAX_REQUESTS: "1", TRUST_PROXY: "true" });

    try {
      const send = (forwardedFor) =>
        app.request("/shorten", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": forwardedFor },
          body: JSON.stringify({ url: "https://example.com/trusted" }),
        });

      assert.equal((await send("1.1.1.1")).status, 201);
      assert.equal((await send("1.1.1.1")).status, 429);
      assert.equal((await send("2.2.2.2")).status, 201, "a different client gets its own bucket");
    } finally {
      await app.close();
    }
  });
});

describe("health probes", () => {
  let app;

  before(async () => {
    app = await startTestApp();
  });

  after(async () => {
    await app.close();
  });

  test("liveness reports ok", async () => {
    const response = await app.request("/healthz");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: "ok" });
  });

  test("readiness reports the active storage driver", async () => {
    const response = await app.request("/readyz");

    assert.equal(response.status, 200);
    assert.equal(response.body.storage, "memory");
  });
});
