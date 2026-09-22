/**
 * The Deslopify rubric: what we ask jev about each LinkedIn post.
 *
 * Design notes (see https://docs.typesafe.ai/primitives and /concepts/how-to-build-with-system-one):
 *  - Every question is atomic and closed set. jev scores one narrow judgement per
 *    question; composition and thresholds live in code (`verdict.js`).
 *  - All questions ship in a single request. TypeSafe's parallel-questions cookbook
 *    measured ~12x cheaper / ~10x faster than one request per question, with the
 *    same answers.
 *  - Question keys are local only (never sent to the model), so we use short ids and
 *    keep the human-readable wording in `instructions`.
 *  - Instructions use backticked paths (`post.text`, `reader.interests`) to point at
 *    state, per the "use structure in the questions" guidance.
 */

/** Bump when the rubric changes shape: invalidates cached verdicts. */
export const RUBRIC_VERSION = 3;
/** Bump when verdict math changes: invalidates cached verdicts. */
export const VERDICT_VERSION = 2;

export const SLOP_SIGNALS = ["engagementBait", "aiBoilerplate", "broetry"];
export const QUALITY_SIGNALS = ["originality", "specificity", "actionable", "worthSaving"];

export const QUESTION_IDS = [
  "verdict",
  "infoDensity",
  "originality",
  "specificity",
  "actionable",
  "promotional",
  "engagementBait",
  "aiBoilerplate",
  "broetry",
  "readerRelevance",
  "worthSaving",
];

export const QUESTION_LABELS = {
  verdict: "Overall call",
  infoDensity: "Information density",
  originality: "Non-obvious",
  specificity: "Concrete specifics",
  actionable: "Actionable",
  promotional: "Promotional",
  engagementBait: "Engagement bait",
  aiBoilerplate: "AI boilerplate",
  broetry: "Broetry / humblebrag",
  readerRelevance: "Relevant to you",
  worthSaving: "Worth saving",
};

/** Signals that read as "good" for the reader; used to pick tooltip drivers. */
export const SIGNAL_POLARITY = {
  verdict: 0,
  infoDensity: 1,
  originality: 1,
  specificity: 1,
  actionable: 1,
  worthSaving: 1,
  readerRelevance: 1,
  promotional: -1,
  engagementBait: -1,
  aiBoilerplate: -1,
  broetry: -1,
};

const clampText = (text, max) =>
  typeof text === "string" && text.length > max ? text.slice(0, max) + " …[truncated]" : (text ?? "");

/**
 * Build the `state` payload sent to jev.
 * @param {object} post extracted post (see content/posts.js)
 * @param {object} reader reader profile subset of settings
 */
export function buildState(post, reader) {
  return {
    post: {
      author: post.author || "unknown",
      author_headline: post.headline || null,
      context: post.context || "feed post", // e.g. "reposted by X", "promoted", "suggested"
      text: post.text,
      quoted_text: post.quotedText || null,
      flags: {
        is_promoted_or_ad: Boolean(post.isPromoted),
        is_suggested: Boolean(post.isSuggested),
        is_repost: Boolean(post.isRepost),
        has_media: Boolean(post.hasMedia),
        has_external_link: Boolean(post.hasLink),
        truncated: Boolean(post.truncated),
      },
    },
    reader: {
      interests: reader.interests,
      considers_slop: reader.slopTriggers,
      considers_golden_nugget: reader.nuggetDefinition,
    },
  };
}

/**
 * Build the `questions` map.
 * @param {object} reader subset of settings (interests / slopTriggers / nuggetDefinition)
 */
export function buildQuestions(reader) {
  return {
    verdict: {
      type: "choice",
      instructions: {
        task: "Decide how a reader should spend their attention on `post.text`, given who the reader is.",
        reader_wants: "`reader.interests`",
        reader_calls_slop: "`reader.considers_slop`",
        reader_calls_nugget: "`reader.considers_golden_nugget`",
        decision_rules: [
          "golden_nugget: the post earns a save or a share. It carries something the reader could not have guessed, with enough concrete detail to act on or verify (specific numbers, named tools, code, first-hand results, a non-obvious claim with reasoning).",
          "useful: a competent, honest post with some value — a clear opinion, a tidy tip, a relevant piece of news — but nothing the reader would bookmark or repeat.",
          "slop: the post's purpose is engagement or promotion rather than informing. Signals: a request to comment/like/share, a cliffhanger that withholds the payoff, generic AI or template prose, performed vulnerability or motivational filler, an advert dressed as a story, or a claim with no substance behind it.",
          "If the post is both promotional and genuinely informative, judge what a skeptical reader actually gets out of it, not the author's intent.",
          "Judge only the content of `post.text` (and `post.quoted_text` when the author is reposting someone else, where the reposter's own commentary leads). If it is mostly a stub or a link with no body, do not reward it as a nugget.",
        ],
      },
      criteria: {
        golden_nugget:
          "Concrete, non-obvious, and relevant: specifics the reader could apply, verify, or quote. The bar is 'I would save this'.",
        useful:
          "Honest and on-topic but ordinary: mildly interesting, thin on specifics, or familiar to the reader. Worth a skim, not a save.",
        slop: "Attention-seeking filler: engagement bait, template or AI prose, humblebrag theatre, or promotion with nothing to take away.",
      },
    },

    infoDensity: {
      type: "score",
      instructions: "How much actual information does `post.text` deliver per sentence?",
      criteria: [
        "0 - Nothing: pure vibes, a question to the audience, an announcement, or an advert.",
        "1 - Thin: one familiar idea restated at length, no supporting detail.",
        "2 - Moderate: a real point with some detail, but nothing the reader did not already know.",
        "3 - Dense: specific facts, numbers, names, or steps; most sentences carry weight.",
        "4 - Very dense: every sentence adds a verifiable or directly usable detail, with no filler.",
      ],
    },

    originality: {
      type: "noul",
      instructions:
        "Does `post.text` contain a non-obvious claim, framework, or first-hand experience that a practitioner in `reader.interests` would not already know?",
      criteria: {
        true: "Surprising or specific enough that the reader learns something new.",
        false: "Restates common knowledge, conventional advice, or a widely repeated talking point.",
      },
    },

    specificity: {
      type: "noul",
      instructions:
        "Does `post.text` contain concrete, checkable specifics — real numbers, named tools or companies, code, dates, sources, or a described first-hand event — rather than vague generalities?",
      criteria: {
        true: "A reader could verify or reproduce at least one claim from the details given.",
        false: "Only abstractions, adjectives, and inspirational phrasing; nothing checkable.",
      },
    },

    actionable: {
      type: "noul",
      instructions:
        "Could a reader in `reader.interests` apply something concrete from `post.text` — a technique, a decision, a resource, or a question worth investigating?",
      criteria: {
        true: "There is a takeaway that changes what the reader does or looks into next.",
        false: "Awareness without a takeaway; nothing the reader can act on.",
      },
    },

    promotional: {
      type: "noul",
      instructions:
        "Is `post.text` primarily promoting the author's product, service, course, newsletter, event, job opening, or personal brand rather than informing the reader?",
      criteria: {
        true: "The payoff for the author, not the reader, drives the post.",
        false: "The post stands on its own as information or opinion, even if the author mentions their work.",
      },
    },

    engagementBait: {
      type: "noul",
      instructions:
        "Does `post.text` try to farm engagement rather than inform — asking for likes/comments/reposts/follows, dangling a reward ('comment YES and I'll send…'), using a cliffhanger that withholds the payoff, or tagging people purely for reach?",
      criteria: {
        true: "The call to action is the point of the post.",
        false: "No engagement farming; any ask is incidental and earned.",
      },
    },

    aiBoilerplate: {
      type: "noul",
      instructions:
        "Does `post.text` read like generic AI-generated or template content: formulaic structure, empty transitions ('in today's fast-paced world'), parallel tricolons, em-dash-heavy lists, confident generalities, and no first-hand detail or lived specifics?",
      criteria: {
        true: "Reads as generated or templated filler rather than something a person experienced and wrote.",
        false: "Reads like a specific human with something to say; AI assistance may be present but is not the substance.",
      },
    },

    broetry: {
      type: "noul",
      instructions:
        "Does `post.text` use LinkedIn 'broetry' or humblebrag conventions — one-sentence-per-line drama, a contrived inspirational arc, performed vulnerability, an unnamed 'a client once told me' anecdote, or a status flex dressed as a lesson?",
      criteria: {
        true: "The formatting and framing are performing for the feed rather than informing.",
        false: "Ordinary prose or a real story told plainly.",
      },
    },

    readerRelevance: {
      type: "noul",
      instructions:
        "Is `post.text` relevant to this specific reader's stated interests (`reader.interests`), regardless of whether it is good?",
      criteria: {
        true: "The reader would plausibly care about the topic.",
        false: "Off-topic for the reader, or too generic to matter to anyone in particular.",
      },
    },

    worthSaving: {
      type: "noul",
      instructions:
        "Would this reader save, bookmark, or share `post.text` to come back to later, given `reader.considers_golden_nugget`?",
      criteria: {
        true: "There is something to return to: a technique, data, a source, or an argument worth keeping.",
        false: "Nothing here needs a second visit once it has been read.",
      },
    },
  };
}
