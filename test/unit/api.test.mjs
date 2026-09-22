import { test } from "node:test";
import assert from "node:assert/strict";

import { callJev, buildRequest, httpError, parseCloudflareResponse, parseTypeSafeResponse } from "../../src/background/api.js";
import { validateRequest } from "../mock-typesafe-server.mjs";
import { buildQuestions, buildState } from "../../src/shared/rubric.js";
import { DEFAULT_SETTINGS } from "../../src/shared/settings.js";
import { ClassifyError } from "../../src/shared/messages.js";

const post = { author: "Dana Reyes", text: "We cut p99 latency from 840ms to 62ms.", truncated: false };

const settings = { ...DEFAULT_SETTINGS, apiKey: "ts_test_key", baseUrl: "https://api.typesafe.ai/v1/systemone" };

const payload = () => ({
  state: buildState(post, settings),
  questions: buildQuestions(settings),
});

test("the TypeSafe adapter sends a request the documented API accepts", () => {
  const request = buildRequest(settings, payload());
  assert.equal(request.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(request.headers.Authorization, "Bearer ts_test_key");
  assert.equal(request.body.model, "jev-latest");
  assert.equal(request.body.state.post.author, "Dana Reyes");
  assert.deepEqual(validateRequest(request.body), [], "our own payload must pass API validation");
});

test("the Cloudflare adapter wraps the same payload in Workers AI's envelope", () => {
  const request = buildRequest(
    { ...settings, provider: "cloudflare", cloudflareAccountId: "acct123", cloudflareApiToken: "cf_token" },
    payload(),
  );
  assert.equal(request.url, "https://api.cloudflare.com/client/v4/accounts/acct123/ai/run");
  assert.equal(request.headers.Authorization, "Bearer cf_token");
  assert.equal(request.body.model, "typesafe/jev");
  assert.ok(request.body.input.state && request.body.input.questions);
  assert.equal(request.body.state, undefined, "Cloudflare expects the payload under `input`");
});

test("missing credentials fail fast with a config error", () => {
  assert.throws(() => buildRequest({ ...settings, apiKey: "" }, payload()), (error) => error.code === "config");
  assert.throws(
    () => buildRequest({ ...settings, provider: "cloudflare", cloudflareAccountId: "" }, payload()),
    (error) => error.code === "config",
  );
});

test("responses are normalised for both providers", () => {
  const answers = { verdict: { type: "choice", choice: "slop" } };
  assert.deepEqual(parseTypeSafeResponse({ model: "jev-1.13.0", answers, usage: { input_tokens: 1 } }), {
    answers,
    usage: { input_tokens: 1 },
    model: "jev-1.13.0",
  });
  assert.deepEqual(parseTypeSafeResponse({ answers }).usage, null, "usage is optional");
});

test("TypeSafe responses without answers throw a typed error", () => {
  assert.throws(() => parseTypeSafeResponse({ error: { message: "bad question" } }), (error) => {
    assert.equal(error.code, "bad_response");
    assert.match(error.message, /bad question/);
    return true;
  });
  assert.throws(() => parseTypeSafeResponse(null), (error) => error.code === "bad_response");
});

test("Cloudflare responses unwrap result, and result.response", () => {
  const answers = { verdict: { type: "choice", choice: "useful" } };
  const wrapped = { success: true, result: { model: "jev-1.13.0", answers, usage: { output_tokens: 9 } } };
  assert.deepEqual(parseCloudflareResponse(wrapped), { answers, usage: { output_tokens: 9 }, model: "jev-1.13.0" });

  const stringified = { result: { response: JSON.stringify({ answers, usage: null, model: "jev-1.13.0" }) } };
  assert.deepEqual(parseCloudflareResponse(stringified).answers, answers);

  assert.throws(() => parseCloudflareResponse({ success: false, errors: [{ message: "quota exceeded" }] }), (error) => {
    assert.equal(error.code, "bad_response");
    assert.match(error.message, /quota exceeded/);
    return true;
  });
});

test("HTTP status codes map to actionable, correctly-retryable errors", () => {
  assert.equal(httpError(401, "").code, "auth");
  assert.equal(httpError(401, "").retryable, false);
  assert.equal(httpError(422, "state is required").message.includes("state is required"), true);
  assert.equal(httpError(429, "").retryable, true);
  assert.equal(httpError(529, "").retryable, true);
  assert.equal(httpError(503, "").code, "http_503");
  assert.equal(httpError(503, "").retryable, true);
  assert.equal(httpError(400, "").retryable, false);
});

test("callJev retries 429 and 5xx, then succeeds", async () => {
  const seen = [];
  const responses = [
    { status: 429, headers: { get: () => "0" }, ok: false, text: async () => "rate limited" },
    { status: 529, headers: { get: () => null }, ok: false, text: async () => "overloaded" },
    {
      status: 200,
      ok: true,
      json: async () => ({ model: "jev-1.13.0", answers: { verdict: { type: "choice", choice: "useful" } }, usage: {} }),
    },
  ];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return responses.shift();
  };

  const result = await callJev(settings, payload(), { fetchImpl });
  assert.equal(seen.length, 3);
  assert.equal(result.attempts, 3);
  assert.equal(result.model, "jev-1.13.0");
  assert.equal(seen[0].init.body.includes("jev-latest"), true, "the body is posted as JSON text");
});

test("callJev gives up immediately on auth errors", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { status: 401, ok: false, headers: { get: () => null }, text: async () => "invalid key" };
  };
  await assert.rejects(() => callJev(settings, payload(), { fetchImpl }), (error) => {
    assert.equal(error.code, "auth");
    assert.equal(error.retryable, false);
    return true;
  });
  assert.equal(calls, 1, "a bad key must not be retried");
});

test("callJev reports timeouts and network failures as retryable", async () => {
  const hang = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  await assert.rejects(() => callJev(settings, payload(), { fetchImpl: hang, attempts: 1, timeoutMs: 20 }), (error) => {
    assert.equal(error.code, "timeout");
    assert.equal(error.retryable, true);
    return true;
  });

  await assert.rejects(
    () =>
      callJev(settings, payload(), {
        fetchImpl: async () => {
          throw new TypeError("Failed to fetch");
        },
        attempts: 1,
      }),
    (error) => {
      assert.equal(error.code, "network");
      assert.equal(error instanceof ClassifyError, true);
      return true;
    },
  );
});
