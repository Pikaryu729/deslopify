import {
  QUESTION_IDS,
  QUESTION_LABELS,
  QUALITY_SIGNALS,
  RUBRIC_VERSION,
  SIGNAL_POLARITY,
  SLOP_SIGNALS,
  VERDICT_VERSION,
} from "./rubric.js";

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (n, dp = 3) => Number(n.toFixed(dp));
const clampSigned = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(-1, n)) : 0);

/** Normalise any jev answer into a 0..1 signal value. */
export function signalValue(id, answer) {
  if (!answer || typeof answer !== "object") return 0;
  if (answer.type === "noul") return clamp01(answer.noul);
  if (answer.type === "score") return clamp01(answer.score / 4); // 5-level rubric
  if (answer.type === "choice") return clamp01(extractProbabilities(answer)[id] ?? 0);
  return 0;
}

/** Pull `{golden_nugget, useful, slop}` out of a choice answer, tolerating missing keys. */
export function extractProbabilities(answer) {
  const raw = answer?.probabilities ?? {};
  const keys = ["golden_nugget", "useful", "slop"];
  let missing = 0;
  const probs = {};
  for (const key of keys) {
    if (Number.isFinite(raw[key])) probs[key] = clamp01(raw[key]);
    else if (answer?.choice === key) probs[key] = 1;
    else {
      probs[key] = 0;
      missing++;
    }
  }
  const sum = probs.golden_nugget + probs.useful + probs.slop;
  if (sum <= 0) return { golden_nugget: 0, useful: 1, slop: 0 }; // unknown => "useful"
  // Normalise a complete-but-unrounded distribution, and anything over 1. A
  // partial distribution is left alone: scaling one 0.7 into a certainty would
  // turn missing data into confidence.
  if (missing === 0 || sum > 1) {
    return {
      golden_nugget: probs.golden_nugget / sum,
      useful: probs.useful / sum,
      slop: probs.slop / sum,
    };
  }
  return probs;
}

/**
 * Hard rules that escalate to slop. Deliberately few, deliberately legible:
 * they exist so that a crowd-pleasing `verdict` answer cannot overrule blatant bait.
 */
export const SLOP_RULES = [
  {
    id: "engagement-bait",
    description: "Explicit engagement farming with nothing concrete behind it",
    test: (s) => s.engagementBait >= 0.85 && s.specificity <= 0.5,
  },
  {
    id: "ai-boilerplate",
    description: "Reads as generated filler with no original content",
    test: (s) => s.aiBoilerplate >= 0.9 && s.originality <= 0.35,
  },
  {
    id: "empty-promo",
    description: "Promotion with nothing the reader can take away",
    test: (s) =>
      s.promotional >= 0.9 && mean([s.originality, s.specificity, s.actionable]) <= 0.4 && s.infoDensity <= 0.35,
  },
];

/**
 * Weight each question's 0..1 value into a signed contribution to the final score.
 * Weights are normalised by their total absolute value, so `score` stays in [-1, 1].
 * `readerRelevance` carries no weight: it gates the nugget bar instead (see below).
 */
function buildTerms(raw, weights) {
  const qualityShare = weights.quality / QUALITY_SIGNALS.length;
  const slopShare = weights.slopSignals / SLOP_SIGNALS.length;
  const terms = [
    { id: "verdict", weight: weights.modelLean, term: raw.verdictLean },
    { id: "infoDensity", weight: weights.density, term: 2 * raw.infoDensity - 1 },
    ...QUALITY_SIGNALS.map((id) => ({ id, weight: qualityShare, term: 2 * raw[id] - 1 })),
    ...SLOP_SIGNALS.map((id) => ({ id, weight: -slopShare, term: 2 * raw[id] - 1 })),
    { id: "promotional", weight: -weights.promotional, term: 2 * raw.promotional - 1 },
  ];
  const total = terms.reduce((sum, t) => sum + Math.abs(t.weight), 0) || 1;
  return terms.map((t) => ({ ...t, contribution: (t.weight * t.term) / total }));
}

/**
 * Turn raw jev answers into a verdict plus the evidence behind it.
 *
 * @param {Record<string, any>} answers answers keyed by question id
 * @param {object} settings Deslopify settings (weights, thresholds)
 * @param {{model?: string, usage?: object}} [meta]
 */
export function computeVerdict(answers, settings, meta = {}) {
  const probabilities = extractProbabilities(answers?.verdict);
  const raw = { verdictLean: probabilities.golden_nugget - probabilities.slop };
  for (const id of QUESTION_IDS) {
    if (id === "verdict") continue;
    raw[id] = signalValue(id, answers?.[id]);
  }

  const terms = buildTerms(raw, settings.weights);
  const score = clampSigned(terms.reduce((sum, t) => sum + t.contribution, 0));
  const slopiness = mean(SLOP_SIGNALS.map((id) => raw[id]));

  // Relevance gates the nugget bar rather than counting as evidence of slop. With no
  // stated reader profile there is nothing to be irrelevant to, so the gate is off.
  const hasReaderProfile = Boolean(String(settings.interests ?? "").trim());
  const requiresRelevant = !hasReaderProfile || raw.readerRelevance >= 0.5;
  const nuggetBar = requiresRelevant ? settings.nuggetThreshold : settings.strictNuggetWithoutRelevance;

  let verdict = "useful";
  if (score >= nuggetBar) verdict = "golden_nugget";
  else if (score <= settings.slopThreshold) verdict = "slop";

  let overridden = null;
  if (verdict !== "slop") {
    const rule = SLOP_RULES.find((r) => r.test(raw));
    if (rule) {
      verdict = "slop";
      overridden = rule.id;
    }
  }

  // Confidence = how sure we are of the label we are about to show. Half of it is
  // the model's own confidence in its choice, half is how far the winning option is
  // ahead of the runner-up (a 40/39/21 split is not a confident call).
  const choiceConfidence = clamp01(answers?.verdict?.confidence ?? 0.5);
  const ranked = Object.values(probabilities).sort((a, b) => b - a);
  const margin = clamp01((ranked[0] - ranked[1]) * 2);
  const confidence = clamp01(0.5 * choiceConfidence + 0.5 * margin);

  return {
    verdict,
    score: round(score, 4),
    confidence: round(confidence, 3),
    uncertain: confidence < settings.minConfidence,
    offTopic: hasReaderProfile && !requiresRelevant,
    overridden,
    probabilities: {
      golden_nugget: round(probabilities.golden_nugget, 4),
      useful: round(probabilities.useful, 4),
      slop: round(probabilities.slop, 4),
    },
    slopiness: round(slopiness, 3),
    signals: [
      {
        id: "verdict",
        label: QUESTION_LABELS.verdict,
        value: round((raw.verdictLean + 1) / 2, 3),
        polarity: 0,
        contribution: round(terms.find((t) => t.id === "verdict").contribution, 4),
      },
      ...QUESTION_IDS.filter((id) => id !== "verdict" && SIGNAL_POLARITY[id] !== 0).map((id) => ({
        id,
        label: QUESTION_LABELS[id],
        value: round(raw[id], 3),
        polarity: SIGNAL_POLARITY[id],
        contribution: round(terms.find((t) => t.id === id)?.contribution ?? 0, 4),
      })),
    ],
    drivers: pickDrivers(terms, raw),
    model: meta.model ?? null,
    usage: meta.usage ?? null,
    rubricVersion: RUBRIC_VERSION,
    verdictVersion: VERDICT_VERSION,
  };
}

/** The four signals that moved the verdict most, phrased for a human. */
function pickDrivers(terms, raw) {
  return terms
    .filter((t) => t.id !== "verdict")
    .filter((t) => Math.abs(t.contribution) >= 0.02)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 4)
    .map((t) => ({
      id: t.id,
      label: QUESTION_LABELS[t.id],
      value: round(raw[t.id], 3),
      direction: t.contribution > 0 ? "up" : "down",
    }));
}

/** One-line human summary for the badge tooltip. */
export function summarise(result) {
  const pct = (p) => Math.round(p * 100);
  if (result.verdict === "golden_nugget") return `${pct(result.probabilities.golden_nugget)}% nugget`;
  if (result.verdict === "slop") return `${pct(result.probabilities.slop)}% slop`;
  return `${pct(result.probabilities.useful)}% useful`;
}
