import { test } from "node:test";
import assert from "node:assert/strict";

import { digest, fnv1a32, stableStringify } from "../../src/shared/hash.js";
import { mergeSettings, configProblem, describeConfig, DEFAULT_SETTINGS } from "../../src/shared/settings.js";

test("fnv1a32 is stable and hex padded", () => {
  assert.equal(fnv1a32(""), "811c9dc5");
  assert.equal(fnv1a32("deslopify"), fnv1a32("deslopify"));
  assert.match(fnv1a32("a longer post body"), /^[0-9a-f]{8}$/);
  assert.notEqual(fnv1a32("post a"), fnv1a32("post b"));
});

test("digest is collision-resistant enough for a cache key and order-independent", () => {
  assert.notEqual(digest("a"), digest("b"));
  assert.equal(digest("same"), digest("same"));
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
  assert.notEqual(stableStringify({ a: 1 }), stableStringify({ a: 2 }));
});

test("settings merge only accepts known keys and keeps nested defaults", () => {
  const merged = mergeSettings(DEFAULT_SETTINGS, { unknownKey: 1, nuggetThreshold: 0.5, weights: { density: 0.9 } });
  assert.equal(merged.unknownKey, undefined);
  assert.equal(merged.nuggetThreshold, 0.5);
  assert.equal(merged.weights.density, 0.9);
  assert.equal(merged.weights.modelLean, DEFAULT_SETTINGS.weights.modelLean);
});

test("a missing credential is reported as an actionable problem", () => {
  assert.match(configProblem({ ...DEFAULT_SETTINGS, apiKey: "" }), /TypeSafe API key/);
  assert.equal(configProblem({ ...DEFAULT_SETTINGS, apiKey: "ts_x" }), null);
  assert.match(
    configProblem({ ...DEFAULT_SETTINGS, provider: "cloudflare", cloudflareAccountId: "", cloudflareApiToken: "t" }),
    /Cloudflare account ID/,
  );
  assert.match(
    configProblem({ ...DEFAULT_SETTINGS, provider: "cloudflare", cloudflareAccountId: "a", cloudflareApiToken: "" }),
    /Cloudflare API token/,
  );
  assert.equal(
    configProblem({ ...DEFAULT_SETTINGS, provider: "cloudflare", cloudflareAccountId: "a", cloudflareApiToken: "t" }),
    null,
  );
  assert.match(configProblem({ ...DEFAULT_SETTINGS, apiKey: "k", baseUrl: "not-a-url" }), /not a valid http/);
});

test("the diagnostics config summary never leaks a credential", () => {
  const described = describeConfig({ ...DEFAULT_SETTINGS, apiKey: "ts_super_secret", cloudflareApiToken: "cf_secret" });
  const serialised = JSON.stringify(described);
  assert.equal(serialised.includes("ts_super_secret"), false);
  assert.equal(serialised.includes("cf_secret"), false);
  assert.equal(described.credentialSet, true);
  assert.equal(described.problem, null);
});
