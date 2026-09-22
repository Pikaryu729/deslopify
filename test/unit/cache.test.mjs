import { test, before } from "node:test";
import assert from "node:assert/strict";

/**
 * `cache.js` pulls in the WebExtension namespace, which does not exist under node.
 * Stub the two APIs it touches before importing it.
 */
before(() => {
  globalThis.chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      onChanged: { addListener() {} },
    },
    runtime: { id: "test" },
  };
});

const { cacheKeyFor } = await import("../../src/background/cache.js");
const { DEFAULT_SETTINGS } = await import("../../src/shared/settings.js");
const { RUBRIC_VERSION, VERDICT_VERSION } = await import("../../src/shared/rubric.js");

const post = { text: "We cut p99 latency from 840ms to 62ms.", author: "Dana Reyes", isPromoted: false, context: "feed post" };

test("identical posts produce identical cache keys", () => {
  assert.equal(cacheKeyFor(post, DEFAULT_SETTINGS), cacheKeyFor({ ...post }, { ...DEFAULT_SETTINGS }));
  assert.ok(cacheKeyFor(post, DEFAULT_SETTINGS).startsWith(`${RUBRIC_VERSION}.${VERDICT_VERSION}.`));
});

test("changing content, model, endpoint or reader profile invalidates the cache", () => {
  const base = cacheKeyFor(post, DEFAULT_SETTINGS);
  assert.notEqual(base, cacheKeyFor({ ...post, text: post.text + " " }, DEFAULT_SETTINGS));
  assert.notEqual(base, cacheKeyFor({ ...post, quotedText: "an added quote" }, DEFAULT_SETTINGS));
  assert.notEqual(base, cacheKeyFor({ ...post, isPromoted: true }, DEFAULT_SETTINGS));
  assert.notEqual(base, cacheKeyFor(post, { ...DEFAULT_SETTINGS, model: "jev-1.12.0" }));
  assert.notEqual(base, cacheKeyFor(post, { ...DEFAULT_SETTINGS, baseUrl: "https://proxy.test/v1/systemone" }));
  assert.notEqual(base, cacheKeyFor(post, { ...DEFAULT_SETTINGS, interests: "gardening" }));
  assert.notEqual(base, cacheKeyFor(post, { ...DEFAULT_SETTINGS, nuggetThreshold: 0.5 }));
  assert.notEqual(base, cacheKeyFor(post, { ...DEFAULT_SETTINGS, weights: { ...DEFAULT_SETTINGS.weights, quality: 0.9 } }));
});

test("switching provider changes the key even with the same model name", () => {
  const typesafe = cacheKeyFor(post, { ...DEFAULT_SETTINGS, model: "typesafe/jev" });
  const cloudflare = cacheKeyFor(post, {
    ...DEFAULT_SETTINGS,
    provider: "cloudflare",
    cloudflareModel: "typesafe/jev",
    cloudflareAccountId: "acct",
  });
  assert.notEqual(typesafe, cloudflare);
});
