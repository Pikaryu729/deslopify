import { test } from "node:test";
import assert from "node:assert/strict";

import { QUESTION_IDS, QUESTION_LABELS, RUBRIC_VERSION, buildQuestions, buildState } from "../../src/shared/rubric.js";
import { DEFAULT_SETTINGS, VERDICTS } from "../../src/shared/settings.js";

const post = {
  author: "Dana Reyes",
  headline: "Staff Engineer",
  text: "We cut p99 latency from 840ms to 62ms.",
  context: "promoted/ad",
  isPromoted: true,
  hasMedia: false,
  hasLink: true,
  truncated: false,
};

test("state carries the post and the reader profile jev needs", () => {
  const state = buildState(post, DEFAULT_SETTINGS);
  assert.equal(state.post.text, post.text);
  assert.equal(state.post.flags.is_promoted_or_ad, true);
  assert.equal(state.reader.interests, DEFAULT_SETTINGS.interests);
  assert.equal(state.reader.considers_slop, DEFAULT_SETTINGS.slopTriggers);
  assert.equal(state.reader.considers_golden_nugget, DEFAULT_SETTINGS.nuggetDefinition);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state, "state must be JSON serialisable");
});

test("every documented question id is asked with a valid shape", () => {
  const questions = buildQuestions(DEFAULT_SETTINGS);
  assert.deepEqual(Object.keys(questions).sort(), [...QUESTION_IDS].sort());
  for (const [id, question] of Object.entries(questions)) {
    assert.ok(["noul", "choice", "score"].includes(question.type), `${id} type`);
    assert.ok(question.instructions, `${id} needs instructions`);
    if (question.type === "choice") {
      assert.deepEqual(Object.keys(question.criteria).sort(), [...VERDICTS].sort(), `${id} criteria must mirror the verdicts`);
    }
    if (question.type === "score") {
      assert.ok(Array.isArray(question.criteria));
      assert.ok(question.criteria.length >= 2 && question.criteria.length <= 10, `${id} score levels`);
    }
  }
});

test("structured instructions point at state paths", () => {
  const questions = buildQuestions(DEFAULT_SETTINGS);
  const serialised = JSON.stringify(questions);
  assert.match(serialised, /`post\.text`/);
  assert.match(serialised, /`reader\.interests`/);
  assert.equal(serialised.includes("undefined"), false);
});

test("labels cover every question and the rubric version is exposed", () => {
  for (const id of QUESTION_IDS) assert.ok(QUESTION_LABELS[id], `${id} has no label`);
  assert.equal(typeof RUBRIC_VERSION, "number");
});
