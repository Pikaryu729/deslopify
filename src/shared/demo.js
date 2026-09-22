/**
 * Demo mode: verdicts with no API key and no network requests.
 *
 * Why this exists:
 *  - store reviewers can see the extension actually work without being handed a
 *    paid credential (a reviewer who sees "needs an API key" and nothing else is
 *    the classic "not functional" rejection);
 *  - a new user can see what Deslopify does before signing up for a provider.
 *
 * It is a small, local, deterministic text classifier — deliberately not a model.
 * It produces jev-shaped answers, so it runs through exactly the same verdict
 * pipeline (`computeVerdict`, the weights, the thresholds, the hard rules) as a
 * real request. Every surface that shows a demo verdict labels it as one.
 */

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/** Distinctive phrases, with the signal they push on. */
const PATTERNS = [
  {
    signal: "engagementBait",
    strength: 0.95,
    re: /\bcomment\s+["']?(yes|link|word|"yes")\b|\bdrop\s+(a\s+)?["']?yes\b|\bagree\s*\?|\brepost\s+if\b|♻️|\btag\s+(someone|a\s+friend)\b|\bthoughts\s*\?\s*$/im,
  },
  {
    signal: "engagementBait",
    strength: 0.6,
    re: /\bfollow\s+me\b|\blike\s+if\b|\bshare\s+this\s+with\b|\bwho\s+else\b|\bam\s+i\s+wrong\b/i,
  },
  {
    signal: "broetry",
    strength: 0.85,
    re: /\bi\s+was\s+crying\b|\bi\s+had\s+nothing\b|\bnobody\s+tells\s+you\b|\bhere\s+is\s+what\s+nobody\b|\bthat\s+changed\s+everything\b|\blet\s+that\s+sink\s+in\b/i,
  },
  {
    signal: "aiBoilerplate",
    strength: 0.8,
    re: /\bin\s+today'?s\s+(fast[- ]paced|ever[- ]changing)\b|\bgame[- ]chang(er|ing)\b|\bunlock(ing)?\s+(your|the)\b|\bdelve\b|\bit'?s\s+not\s+just\b|\bhere'?s\s+the\s+thing\b|\bthe\s+future\s+of\s+work\b|\bleverage\b/i,
  },
  {
    signal: "promotional",
    strength: 0.85,
    re: /\bbook\s+a\s+demo\b|\bsign\s+up\b|\bjoin\s+my\b|\bmy\s+(course|newsletter|playbook|ebook|program)\b|\bdm\s+me\b|\blink\s+in\s+(the\s+)?(comments|bio)\b|\bwe'?re\s+hiring\b|\bavailable\s+now\b/i,
  },
  {
    signal: "specificity",
    strength: 0.5,
    re: /\b\d+(\.\d+)?\s*(ms|s|gb|mb|kb|%|x|k|m|hours?|minutes?|days?|weeks?|months?|rows?|users?|requests?)\b|\$\d|\bp\d{2}\b|\bv?\d+\.\d+\.\d+\b/i,
  },
  {
    signal: "specificity",
    strength: 0.35,
    re: /\b(postgres|mysql|sqlite|redis|kafka|kubernetes|docker|terraform|react|vue|svelte|python|rust|golang|typescript|node|graphql|grpc|aws|gcp|azure|stripe|salesforce)\b/i,
  },
  {
    signal: "actionable",
    strength: 0.4,
    re: /\bhere'?s\s+how\b|\bstep\s*\d\b|\bthe\s+fix\s+was\b|\bwe\s+(changed|rewrote|replaced|moved)\b|\btry\s+this\b|\bwhat\s+worked\b/i,
  },
  {
    signal: "originality",
    strength: 0.35,
    re: /\bwe\s+(measured|benchmarked|profiled|instrumented)\b|\bi\s+(measured|tested|built|shipped|profiled)\b|\bthe\s+data\s+showed\b|\bturned\s+out\s+to\s+be\b/i,
  },
];

const countMatches = (text, re) => (text.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) ?? []).length;

/** How much of the post is one-sentence-per-line drama. */
function broetryShape(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 4) return 0;
  const short = lines.filter((line) => line.length <= 48).length / lines.length;
  return clamp01((short - 0.5) * 2);
}

/** Word overlap with the reader's stated interests. */
function relevance(text, interests) {
  const words = new Set(
    String(interests ?? "")
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .filter((word) => word.length > 3),
  );
  if (!words.size) return 0.5;
  const post = text.toLowerCase();
  const hits = [...words].filter((word) => post.includes(word)).length;
  return clamp01(0.25 + hits / 4);
}

/**
 * Build jev-shaped answers for a post, entirely locally.
 *
 * @param {object} post extracted post (see content/posts.js)
 * @param {object} settings Deslopify settings (uses `interests`)
 * @returns {Record<string, object>} answers keyed by question id
 */
export function demoAnswers(post, settings) {
  const text = `${post.text ?? ""}\n${post.quotedText ?? ""}`;
  const signals = {
    engagementBait: 0.05,
    broetry: 0.05,
    aiBoilerplate: 0.05,
    promotional: 0.05,
    specificity: 0.08,
    actionable: 0.1,
    originality: 0.1,
    worthSaving: 0.1,
  };

  for (const pattern of PATTERNS) {
    if (pattern.re.test(text)) {
      signals[pattern.signal] = clamp01(Math.max(signals[pattern.signal], pattern.strength));
      // A bait-heavy post that is also specific is rarer than one that is not.
      if (pattern.signal === "specificity") signals.specificity = clamp01(signals.specificity + 0.1 * countMatches(text, pattern.re));
    }
  }

  signals.broetry = clamp01(Math.max(signals.broetry, broetryShape(text)));
  if (post.isPromoted) signals.promotional = clamp01(Math.max(signals.promotional, 0.7));
  if (post.isRepost) signals.originality = clamp01(signals.originality - 0.05);

  const words = text.split(/\s+/).filter(Boolean).length;
  const digits = (text.match(/\d/g) ?? []).length;
  const numbersPer100 = words > 0 ? (digits / words) * 100 : 0;

  // Density follows numbers and concrete nouns, and is capped by length.
  const density = clamp01(0.15 + numbersPer100 / 3 + signals.specificity * 0.5 - signals.engagementBait * 0.3);
  signals.worthSaving = clamp01((signals.specificity + signals.originality) / 2 - signals.engagementBait * 0.4 - signals.promotional * 0.2);
  signals.actionable = clamp01(Math.max(signals.actionable, signals.specificity * 0.8));

  const slopiness = (signals.engagementBait + signals.aiBoilerplate + signals.broetry + signals.promotional * 0.7) / 3.7;
  const quality = (signals.originality + signals.specificity + signals.actionable + signals.worthSaving) / 4;

  // A deliberately simple lean, then probabilities that sum to 1.
  const nugget = clamp01(quality * 0.85 + density * 0.25 - slopiness * 0.5 - 0.12);
  const slop = clamp01(slopiness * 0.9 - quality * 0.25 + 0.04);
  const useful = clamp01(1 - nugget - slop);
  const total = nugget + useful + slop || 1;
  const probabilities = {
    golden_nugget: nugget / total,
    useful: useful / total,
    slop: slop / total,
  };
  const ranked = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);

  return {
    verdict: {
      type: "choice",
      choice: ranked[0][0],
      probabilities,
      // Demo mode is honest about being a heuristic: never claim high confidence.
      confidence: clamp01(0.45 + (ranked[0][1] - ranked[1][1]) * 0.4),
    },
    infoDensity: { type: "score", score: density * 4, confidence: 0.6, probabilities: {}, legend: {} },
    originality: { type: "noul", noul: signals.originality },
    specificity: { type: "noul", noul: signals.specificity },
    actionable: { type: "noul", noul: signals.actionable },
    promotional: { type: "noul", noul: signals.promotional },
    engagementBait: { type: "noul", noul: signals.engagementBait },
    aiBoilerplate: { type: "noul", noul: signals.aiBoilerplate },
    broetry: { type: "noul", noul: signals.broetry },
    readerRelevance: { type: "noul", noul: relevance(text, settings?.interests) },
    worthSaving: { type: "noul", noul: signals.worthSaving },
  };
}
