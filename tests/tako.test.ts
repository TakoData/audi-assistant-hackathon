import test from "node:test";
import assert from "node:assert/strict";
import { askTako, isWeatherQuery, TakoRequestError, toGlanceableUrl } from "../src/tako";

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

test("normalizes a successful answer and glanceable card", async () => {
  const answer = await askTako("Volkswagen revenue", "test-key", {
    fetchImpl: async () => jsonResponse({
      answer: "Volkswagen reported revenue.",
      cards: [{ card_id: "vw-1", title: "VW revenue", embed_url: "https://tako.com/embed/abc", sources: [{ source_name: "Annual report" }] }],
      request_id: "upstream-1",
    }),
    attemptTimeouts: [100],
  });
  assert.equal(answer.answer, "Volkswagen reported revenue.");
  assert.equal(answer.cards[0]?.id, "vw-1");
  assert.deepEqual(answer.cards[0]?.sources, ["Annual report"]);
  assert.equal(answer.requestId, "upstream-1");
});

test("retries one transient network failure", async () => {
  let calls = 0;
  const retries: string[] = [];
  const answer = await askTako("Volkswagen deliveries", "test-key", {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("DNS lookup failed");
      return jsonResponse({ answer: "Delivery answer", cards: [] });
    },
    attemptTimeouts: [100, 100],
    retryDelayMs: 0,
    onRetry: (_attempt, reason) => retries.push(reason),
  });
  assert.equal(calls, 2);
  assert.equal(answer.attemptCount, 2);
  assert.deepEqual(retries, ["network"]);
});

test("turns a timeout into a safe timeout error", async () => {
  const hangingFetch = ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  })) as typeof fetch;
  await assert.rejects(
    askTako("Slow question", "test-key", { fetchImpl: hangingFetch, attemptTimeouts: [5] }),
    (error: unknown) => error instanceof TakoRequestError && error.code === "timeout",
  );
});

test("does not retry authorization or rate-limit failures", async () => {
  for (const [status, code] of [[401, "auth"], [429, "rate-limit"]] as const) {
    let calls = 0;
    await assert.rejects(
      askTako("Question", "test-key", {
        fetchImpl: async () => { calls += 1; return jsonResponse({ error: "No" }, status); },
        attemptTimeouts: [100, 100],
        retryDelayMs: 0,
      }),
      (error: unknown) => error instanceof TakoRequestError && error.code === code,
    );
    assert.equal(calls, 1);
  }
});

test("rejects malformed successful payloads", async () => {
  await assert.rejects(
    askTako("Question", "test-key", { fetchImpl: async () => jsonResponse({ cards: [] }), attemptTimeouts: [100] }),
    (error: unknown) => error instanceof TakoRequestError && error.code === "invalid-response",
  );
});

test("weather requests include vehicle grounding and both Tako sources", async () => {
  let sentBody: any;
  await askTako("Will it rain in Wolfsburg today?", "test-key", {
    fetchImpl: async (_url, init) => {
      sentBody = JSON.parse(String(init?.body));
      return jsonResponse({ answer: "No rain expected.", cards: [] });
    },
    attemptTimeouts: [100],
  });
  assert.equal(isWeatherQuery("temperature tomorrow"), true);
  assert.equal(sentBody.country_code, "DE");
  assert.equal(sentBody.timezone, "Europe/Berlin");
  assert.deepEqual(sentBody.sources, { data: { count: 10 }, web: { count: 10 } });
});

test("glanceable URLs preserve existing parameters", () => {
  const url = toGlanceableUrl("https://tako.com/embed/abc?foo=bar");
  assert.match(url, /foo=bar/);
  assert.match(url, /glanceable=true/);
  assert.match(url, /dark_mode=true/);
});
