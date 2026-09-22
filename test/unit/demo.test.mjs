/**
 * Demo mode exists so a store reviewer — or a curious user — can see Deslopify
 * work with no API key. These tests pin the two promises it makes: the answers are
 * shaped exactly like jev's (so the real verdict pipeline runs), and nothing is
 * ever sent anywhere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { demoAnswers } from "../../src/shared/demo.js";
import { QUESTION_IDS } from "../../src/shared/rubric.js";
import { DEFAULT_SETTINGS, configProblem, describeConfig } from "../../src/shared/settings.js";
import { computeVerdict } from "../../src/shared/verdict.js";

const settings = DEFAULT_SETTINGS;

const post = (text, extra = {}) => ({ author: "Someone", text, quotedText: "", context: "feed post", ...extra });

const SPECIFIC = `We rewrote our billing retry worker and the p99 latency on /charge dropped from 840ms to 62ms.
Three things mattered: an index scan that was really a seq scan over 40M rows, moving the exponential backoff
into the worker instead of the HTTP layer, and cutting the payload we wrote to the audit table.`;

const BAIT = `3 years ago I was crying in my car. I had nothing. Today I run a 7-figure agency.
Here is what nobody tells you about success. Comment "YES" and I'll send you my 47-page playbook. Agree?`;

test("demo answers have exactly the shape jev returns", () => {
  const answers = demoAnswers(post(SPECIFIC), settings);
  assert.deepEqual(Object.keys(answers).sort(), [...QUESTION_IDS].sort(), "every question is answered");
  for (const [id, answer] of Object.entries(answers)) {
    if (id === "verdict") {
      assert.equal(answer.type, "choice");
      assert.ok(["golden_nugget", "useful", "slop"].includes(answer.choice), "a real verdict label");
      const sum = Object.values(answer.probabilities).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - 1) < 1e-9, `${id} probabilities sum to 1`);
      assert.ok(answer.confidence > 0 && answer.confidence <= 1);
    } else if (id === "infoDensity") {
      assert.equal(answer.type, "score");
      assert.ok(answer.score >= 0 && answer.score <= 4, "score is on the 0-4 rubric");
    } else {
      assert.equal(answer.type, "noul");
      assert.ok(answer.noul >= 0 && answer.noul <= 1, `${id} is a probability`);
    }
  }
});

test("demo answers run through the real verdict pipeline", () => {
  const concrete = computeVerdict(demoAnswers(post(SPECIFIC), settings), settings, { model: "demo" });
  const bait = computeVerdict(demoAnswers(post(BAIT), settings), settings, { model: "demo" });
  assert.equal(concrete.verdict, "golden_nugget");
  assert.equal(bait.verdict, "slop");
  assert.ok(concrete.score > bait.score, "a specific post must outrank a bait post");
  // Demo mode must not pretend to be certain.
  assert.ok(concrete.confidence < 0.9);
});

test("promoted posts read as promotional without a model", () => {
  const answers = demoAnswers(post("Ship faster with VectorBase. Book a demo today.", { isPromoted: true }), settings);
  assert.ok(answers.promotional.noul >= 0.7, "an ad is flagged promotional");
  assert.equal(computeVerdict(answers, settings).verdict !== "golden_nugget", true);
});

test("demo answers are deterministic", () => {
  const a = demoAnswers(post(SPECIFIC), settings);
  const b = demoAnswers(post(SPECIFIC), settings);
  assert.deepEqual(a, b);
});

test("demo relevance follows the reader profile", () => {
  const rustPost = post("We benchmarked a Rust rewrite of our packet parser and profiled the allocator.");
  const onTopic = demoAnswers(rustPost, { interests: "Rust, systems programming, performance" });
  const offTopic = demoAnswers(rustPost, { interests: "gardening and home cooking" });
  assert.ok(onTopic.readerRelevance.noul > offTopic.readerRelevance.noul);
});

test("demo mode removes the credential requirement", () => {
  assert.match(configProblem({ ...settings, apiKey: "" }), /TypeSafe API key/);
  assert.equal(configProblem({ ...settings, apiKey: "", demoMode: true }), null, "no key needed in demo mode");
  const described = describeConfig({ ...settings, apiKey: "", demoMode: true });
  assert.equal(described.problem, null);
  assert.equal(described.demoMode, true);
  assert.equal(described.credentialSet, false, "it must not claim a credential it does not have");
});

test("a short stub is not celebrated as a nugget", () => {
  const result = computeVerdict(demoAnswers(post("Great post!"), settings), settings);
  assert.notEqual(result.verdict, "golden_nugget");
});
