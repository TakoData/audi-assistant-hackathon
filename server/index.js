const path = require("path");
const crypto = require("crypto");

require("dotenv").config({
  path: [path.resolve(__dirname, "../.env.local"), path.resolve(__dirname, "../.env")]
});

const cors = require("cors");
const express = require("express");

const DEFAULT_TAKO_URL = "https://tako.com/api/v1/answer";
const RELAY_VERSION = "1.4.0";
const vehicleLocation = { latitude: 52.4227, longitude: 10.7865 };

function isWeatherQuery(query) {
  return /\b(weather|forecast|temperature|rain|snow|sunny|wind|humidity)\b/i.test(query);
}

function tokenMatches(received, expected) {
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

function requestPayload(query) {
  return {
    query,
    effort: "fast",
    ...(isWeatherQuery(query) ? { sources: { data: { count: 10 }, web: { count: 10 } } } : {}),
    location: vehicleLocation,
    country_code: "DE",
    locale: "en-US",
    timezone: "Europe/Berlin",
    output_settings: { image_dark_mode: true }
  };
}

function wait(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function createApp(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const log = options.log || console;
  const requestsByClient = new Map();
  const rateLimit = Number(env.DEMO_RATE_LIMIT_PER_HOUR || 60);
  const takoUrl = env.TAKO_API_URL || DEFAULT_TAKO_URL;
  const app = express();

  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "32kb" }));
  app.use((request, response, next) => {
    const requestId = request.get("x-request-id") || crypto.randomUUID();
    request.requestId = requestId;
    response.set("X-Request-Id", requestId);
    next();
  });

  function authorizeDemo(request, response, next) {
    const expectedToken = env.DEMO_ACCESS_TOKEN;
    if (!expectedToken) return response.status(503).json({ error: "The demo relay is not configured.", request_id: request.requestId });

    const authorization = request.get("authorization") || "";
    const receivedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!tokenMatches(receivedToken, expectedToken)) {
      return response.status(401).json({ error: "This demo build is not authorized.", request_id: request.requestId });
    }

    const timestamp = now();
    const windowStart = timestamp - 60 * 60 * 1000;
    const clientId = request.ip || request.socket.remoteAddress || "unknown";
    const recentRequests = (requestsByClient.get(clientId) || []).filter((seenAt) => seenAt > windowStart);
    if (recentRequests.length >= rateLimit) {
      response.set("Retry-After", "3600");
      return response.status(429).json({ error: "This demo has reached its hourly request limit.", request_id: request.requestId });
    }
    recentRequests.push(timestamp);
    requestsByClient.set(clientId, recentRequests);
    return next();
  }

  async function fetchUpstream(query, requestId) {
    if (!env.TAKO_API_KEY) {
      const error = new Error("TAKO_API_KEY is not configured on the relay.");
      error.status = 503;
      throw error;
    }

    const timeouts = options.upstreamTimeouts || [16_000, 26_000];
    let lastError;
    for (let attempt = 0; attempt < timeouts.length; attempt += 1) {
      try {
        const upstream = await fetchImpl(takoUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": env.TAKO_API_KEY,
            "X-Request-Id": requestId
          },
          body: JSON.stringify(requestPayload(query)),
          signal: AbortSignal.timeout(timeouts[attempt])
        });
        const payload = await upstream.json().catch(() => null);
        if (!upstream.ok) {
          const error = new Error(payload?.error_message || payload?.error || `Tako returned ${upstream.status}`);
          error.status = upstream.status;
          error.payload = payload;
          if (upstream.status < 500 || attempt === timeouts.length - 1) throw error;
          lastError = error;
          await wait(400);
          continue;
        }
        if (!payload || typeof payload.answer !== "string" || !payload.answer.trim()) {
          const error = new Error("Tako returned an invalid response.");
          error.status = 502;
          throw error;
        }
        return { payload, attempts: attempt + 1 };
      } catch (error) {
        lastError = error;
        const status = Number(error?.status || 0);
        const retryable = !status || status >= 500;
        if (!retryable || attempt === timeouts.length - 1) throw error;
        await wait(400);
      }
    }
    throw lastError;
  }

  function applyFault(request, response) {
    if (env.DEMO_FAULT_INJECTION !== "true") return false;
    const fault = request.get("x-demo-fault");
    if (!fault) return false;
    if (fault === "401") response.status(401).json({ error: "Injected authorization failure." });
    else if (fault === "429") response.status(429).json({ error: "Injected rate limit." });
    else if (fault === "500") response.status(500).json({ error: "Injected upstream failure." });
    else if (fault === "malformed") response.json({ cards: [] });
    else if (fault === "no-card") response.json({ answer: "Injected text-only answer.", cards: [], request_id: request.requestId });
    else if (fault === "bad-card") response.json({ answer: "Injected answer with a broken visual.", cards: [{ id: "bad", title: "Unavailable visual", embed_url: "https://invalid.invalid/card", sources: ["Test"] }], request_id: request.requestId });
    else return false;
    return true;
  }

  app.get("/health", (request, response) => {
    response.json({
      ok: true,
      configured: Boolean(env.TAKO_API_KEY && env.DEMO_ACCESS_TOKEN),
      service: "vw-assistant-relay",
      version: RELAY_VERSION,
      timestamp: new Date(now()).toISOString(),
      request_id: request.requestId
    });
  });

  app.post("/ready", authorizeDemo, async (request, response) => {
    const startedAt = now();
    try {
      const { payload, attempts } = await fetchUpstream("What is Volkswagen's stock ticker?", request.requestId);
      return response.json({
        ok: true,
        upstream: "tako-answer",
        answer_present: Boolean(payload.answer),
        card_count: Array.isArray(payload.cards) ? payload.cards.length : 0,
        attempts,
        elapsed_ms: now() - startedAt,
        request_id: request.requestId
      });
    } catch (error) {
      return response.status(Number(error?.status) || 502).json({ error: "The live answer check failed.", request_id: request.requestId });
    }
  });

  app.post("/answer", authorizeDemo, async (request, response) => {
    if (applyFault(request, response)) return;
    const query = typeof request.body?.query === "string" ? request.body.query.trim() : "";
    if (!query || query.length > 500) {
      return response.status(400).json({ error: "Query must be between 1 and 500 characters.", request_id: request.requestId });
    }

    if (env.DEMO_MODE === "true") {
      return response.json({
        answer: "Nvidia has grown to about 36,000 full-time employees as of the end of 2024, up roughly 309 percent from about 8,800 in 2013. AMD reached about 28,000 over the same period.",
        cards: [{ id: "demo-headcount", title: "Nvidia and AMD headcount since 2013", embed_url: "https://tako.com/embed/geYufvSx04pyWX7GpHeR/", sources: ["Tako"] }],
        request_id: request.requestId
      });
    }

    const startedAt = now();
    try {
      const { payload, attempts } = await fetchUpstream(query, request.requestId);
      const elapsedMs = now() - startedAt;
      log.info?.(JSON.stringify({ event: "answer_success", request_id: request.requestId, elapsed_ms: elapsedMs, attempts, query_hash: crypto.createHash("sha256").update(query).digest("hex").slice(0, 12) }));
      response.set("X-Upstream-Attempts", String(attempts));
      return response.json({ ...payload, request_id: payload.request_id || request.requestId });
    } catch (error) {
      const status = Number(error?.status) || 502;
      const safeStatus = status >= 400 && status < 600 ? status : 502;
      log.error?.(JSON.stringify({ event: "answer_failure", request_id: request.requestId, elapsed_ms: now() - startedAt, status: safeStatus, error: error instanceof Error ? error.message : "Unknown error" }));
      const publicMessage = safeStatus === 401 || safeStatus === 403
        ? "The Tako credentials were not accepted."
        : safeStatus === 429
          ? "The answer service is receiving too many requests."
          : safeStatus === 503
            ? "The demo relay is not configured."
            : "The live answer service had a temporary problem.";
      return response.status(safeStatus).json({ error: publicMessage, request_id: request.requestId });
    }
  });

  return app;
}

const app = createApp();

if (require.main === module) {
  const port = Number(process.env.PORT || 8787);
  app.listen(port, "0.0.0.0", () => {
    console.log(`VW Assistant relay ${RELAY_VERSION} listening on http://0.0.0.0:${port}`);
  });
}

module.exports = app;
module.exports.createApp = createApp;
module.exports.requestPayload = requestPayload;
module.exports.isWeatherQuery = isWeatherQuery;
