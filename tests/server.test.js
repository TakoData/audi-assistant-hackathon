const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp, requestPayload } = require("../server/index");

const baseEnv = {
  DEMO_ACCESS_TOKEN: "demo-token",
  TAKO_API_KEY: "tako-key",
  DEMO_RATE_LIMIT_PER_HOUR: "60",
};
const silentLog = { info() {}, error() {} };

async function withServer(app, run) {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function authorized(body, headers = {}) {
  return { method: "POST", headers: { Authorization: "Bearer demo-token", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) };
}

test("health reports whether the relay is configured", async () => {
  const app = createApp({ env: baseEnv, log: silentLog });
  await withServer(app, async (url) => {
    const response = await fetch(`${url}/health`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.configured, true);
    assert.equal(payload.version, "1.4.0");
    assert.ok(response.headers.get("x-request-id"));
  });
});

test("answer rejects missing authorization without calling Tako", async () => {
  let calls = 0;
  const app = createApp({ env: baseEnv, fetchImpl: async () => { calls += 1; return new Response(); }, log: silentLog });
  await withServer(app, async (url) => {
    const response = await fetch(`${url}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "hello" }) });
    assert.equal(response.status, 401);
    assert.equal(calls, 0);
  });
});

test("answer retries a transient upstream 500 and returns a traceable response", async () => {
  let calls = 0;
  const app = createApp({
    env: baseEnv,
    upstreamTimeouts: [100, 100],
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ error: "temporary" }), { status: 500 });
      return new Response(JSON.stringify({ answer: "Recovered answer", cards: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    log: silentLog,
  });
  await withServer(app, async (url) => {
    const response = await fetch(`${url}/answer`, authorized({ query: "Volkswagen" }));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-upstream-attempts"), "2");
    assert.equal(payload.answer, "Recovered answer");
    assert.ok(payload.request_id);
    assert.equal(calls, 2);
  });
});

test("malformed upstream success fails safely", async () => {
  const app = createApp({ env: baseEnv, upstreamTimeouts: [100], fetchImpl: async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }), log: silentLog });
  await withServer(app, async (url) => {
    const response = await fetch(`${url}/answer`, authorized({ query: "Volkswagen" }));
    const payload = await response.json();
    assert.equal(response.status, 502);
    assert.match(payload.error, /temporary problem/i);
    assert.ok(payload.request_id);
  });
});

test("fault injection is disabled by default and deterministic when enabled", async () => {
  const disabled = createApp({ env: { ...baseEnv, DEMO_MODE: "true" }, log: silentLog });
  await withServer(disabled, async (url) => {
    const response = await fetch(`${url}/answer`, authorized({ query: "hello" }, { "X-Demo-Fault": "500" }));
    assert.equal(response.status, 200);
  });

  const enabled = createApp({ env: { ...baseEnv, DEMO_FAULT_INJECTION: "true" }, log: silentLog });
  await withServer(enabled, async (url) => {
    const noCard = await fetch(`${url}/answer`, authorized({ query: "hello" }, { "X-Demo-Fault": "no-card" }));
    assert.equal(noCard.status, 200);
    assert.deepEqual((await noCard.json()).cards, []);
    const failure = await fetch(`${url}/answer`, authorized({ query: "hello" }, { "X-Demo-Fault": "500" }));
    assert.equal(failure.status, 500);
  });
});

test("ready performs a real upstream-shaped probe", async () => {
  const app = createApp({ env: baseEnv, upstreamTimeouts: [100], fetchImpl: async () => new Response(JSON.stringify({ answer: "VWAGY", cards: [{ id: "1" }] }), { status: 200, headers: { "Content-Type": "application/json" } }), log: silentLog });
  await withServer(app, async (url) => {
    const response = await fetch(`${url}/ready`, authorized({}));
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.answer_present, true);
    assert.equal(payload.card_count, 1);
  });
});

test("weather payload stays grounded to the vehicle", () => {
  const payload = requestPayload("weather today");
  assert.equal(payload.country_code, "DE");
  assert.equal(payload.location.latitude, 52.4227);
  assert.ok(payload.sources.data);
  assert.ok(payload.sources.web);
});
