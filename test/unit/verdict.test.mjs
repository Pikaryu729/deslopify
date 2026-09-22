import { test } from "node:test";
import assert from "node:assert/strict";

import { computeVerdict, extractProbabilities, signalValue, summarise } from "../../src/shared/verdict.js";
import { QUESTION_IDS } from "../../src/shared/rubric.js";
import { DEFAULT_SETTINGS } from "../../src/shared/settings.js";

const settings = DEFAULT_SETTINGS;

/** Build a full answer set from a compact profile. */
function answers(profile) {
  const out = {
    verdict: {
      type: "choice",
      choice: profile.choice ?? "useful",
      probabilities: profile.probabilities ?? { golden_nugget: 0.15, useful: 0.7, slop: 0.15 },
      confidence: profile.confidence ?? 0.7,
    },
  };
  for (const id of QUESTION_IDS) {
    if (id === "verdict") continue;
    out[id] = id === "infoDensity"
      ? { type: "score", score: profile.infoDensity ?? 1.6, confidence: 0.8, probabilities: {} }
      : { type: "noul", noul: profile[id] ?? 0.5 };
  }
  return out;
}

const NUGGET = {
  choice: "golden_nugget",
  probabilities: { golden_nugget: 0.82, useful: 0.16, slop: 0.02 },
  confidence: 0.79,
  infoDensity: 3.4,
  originality: 0.88,
  specificity: 0.94,
  actionable: 0.8,
  promotional: 0.1,
  engagementBait: 0.02,
  aiBoilerplate: 0.08,
  broetry: 0.05,
  readerRelevance: 0.9,
  worthSaving: 0.9,
};

const USEFUL = {
  choice: "useful",
  probabilities: { useful: 0.7, golden_nugget: 0.15, slop: 0.15 },
  confidence: 0.66,
  infoDensity: 1.6,
  originality: 0.45,
  specificity: 0.3,
  actionable: 0.4,
  promotional: 0.2,
  engagementBait: 0.05,
  aiBoilerplate: 0.2,
  broetry: 0.15,
  readerRelevance: 0.7,
  worthSaving: 0.3,
};

const SLOP = {
  choice: "slop",
  probabilities: { slop: 0.86, useful: 0.11, golden_nugget: 0.03 },
  confidence: 0.83,
  infoDensity: 0.3,
  originality: 0.1,
  specificity: 0.1,
  actionable: 0.12,
  promotional: 0.55,
  engagementBait: 0.95,
  aiBoilerplate: 0.7,
  broetry: 0.9,
  readerRelevance: 0.4,
  worthSaving: 0.05,
};

test("a concrete, first-hand post lands on golden nugget", () => {
  const result = computeVerdict(answers(NUGGET), settings, { model: "jev-1.13.0", usage: { input_tokens: 1, output_tokens: 2 } });
  assert.equal(result.verdict, "golden_nugget");
  assert.ok(result.score > settings.nuggetThreshold, `score ${result.score} should clear the nugget bar`);
  assert.equal(result.uncertain, false);
  assert.equal(result.offTopic, false);
  assert.equal(result.model, "jev-1.13.0");
  assert.deepEqual(result.usage, { input_tokens: 1, output_tokens: 2 });
});

test("engagement bait lands on slop", () => {
  const result = computeVerdict(answers(SLOP), settings);
  assert.equal(result.verdict, "slop");
  assert.ok(result.score <= settings.slopThreshold);
});

test("an ordinary opinion post stays useful", () => {
  const result = computeVerdict(answers(USEFUL), settings);
  assert.equal(result.verdict, "useful");
  assert.ok(result.score > settings.slopThreshold && result.score < settings.nuggetThreshold);
});

test("hard rules override a lenient model verdict", () => {
  const lenient = answers({
    ...USEFUL,
    probabilities: { useful: 0.6, golden_nugget: 0.3, slop: 0.1 },
    engagementBait: 0.95,
    specificity: 0.1,
    infoDensity: 1.1,
  });
  const result = computeVerdict(lenient, settings);
  assert.equal(result.verdict, "slop");
  assert.equal(result.overridden, "engagement-bait");
});

test("relevance gates the nugget bar instead of counting as slop evidence", () => {
  const mid = {
    choice: "golden_nugget",
    probabilities: { golden_nugget: 0.45, useful: 0.45, slop: 0.1 },
    confidence: 0.6,
    infoDensity: 2,
    originality: 0.6,
    specificity: 0.6,
    actionable: 0.6,
    worthSaving: 0.6,
    promotional: 0.1,
    engagementBait: 0.1,
    aiBoilerplate: 0.1,
    broetry: 0.1,
  };
  const onTopic = computeVerdict(answers({ ...mid, readerRelevance: 0.9 }), settings);
  const offTopic = computeVerdict(answers({ ...mid, readerRelevance: 0.2 }), settings);

  assert.ok(onTopic.score >= settings.nuggetThreshold && onTopic.score < settings.strictNuggetWithoutRelevance);
  assert.equal(onTopic.verdict, "golden_nugget");
  assert.equal(offTopic.verdict, "useful");
  assert.equal(offTopic.offTopic, true);
});

test("a near-tie is reported as low confidence", () => {
  const result = computeVerdict(
    answers({ ...USEFUL, probabilities: { golden_nugget: 0.34, useful: 0.33, slop: 0.33 }, confidence: 0.2 }),
    settings,
  );
  assert.equal(result.uncertain, true);
  assert.ok(result.confidence < settings.minConfidence);
});

test("confidence follows the winning label, not just the nugget/slop split", () => {
  // A confident "useful" call has zero nugget/slop margin but a wide winning margin.
  const result = computeVerdict(answers(USEFUL), settings);
  assert.equal(result.verdict, "useful");
  assert.equal(result.uncertain, false);
  assert.ok(result.confidence > 0.8, `expected a confident call, got ${result.confidence}`);
});

test("probabilities are normalised and survive a distribution-less answer", () => {
  const bare = computeVerdict({ verdict: { type: "choice", choice: "slop" } }, settings);
  assert.deepEqual(bare.probabilities, { golden_nugget: 0, useful: 0, slop: 1 });
  assert.equal(extractProbabilities(undefined).useful, 1, "missing answers fall back to 'useful'");
  const noisy = extractProbabilities({ type: "choice", choice: "slop", probabilities: { slop: 2, useful: 2, golden_nugget: 0 } });
  assert.equal(noisy.slop + noisy.useful + noisy.golden_nugget, 1);
});

test("signals and drivers are consistent with the score", () => {
  const result = computeVerdict(answers(NUGGET), settings);
  assert.equal(result.drivers.length <= 4, true);
  assert.ok(result.drivers.every((d) => ["up", "down"].includes(d.direction)));
  const total = result.signals.reduce((sum, s) => sum + s.contribution, 0);
  assert.ok(Math.abs(total - result.score) < 1e-6, `contributions ${total} should sum to score ${result.score}`);
  assert.ok(result.drivers.every((d) => QUESTION_IDS.includes(d.id)));
});

test("signalValue maps every primitive onto 0..1", () => {
  assert.equal(signalValue("x", { type: "noul", noul: 0.42 }), 0.42);
  assert.equal(signalValue("x", { type: "score", score: 2 }), 0.5);
  assert.equal(signalValue("x", { type: "score", score: 99 }), 1);
  assert.equal(signalValue("golden_nugget", { type: "choice", probabilities: { golden_nugget: 0.7 } }), 0.7);
  assert.equal(signalValue("x", undefined), 0);
});

test("summary text names the winning verdict", () => {
  assert.match(summarise(computeVerdict(answers(SLOP), settings)), /slop/);
  assert.match(summarise(computeVerdict(answers(NUGGET), settings)), /nugget/);
  assert.match(summarise(computeVerdict(answers(USEFUL), settings)), /useful/);
});
