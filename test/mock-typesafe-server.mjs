/**
 * A stand-in for the TypeSafe system-one endpoint, used by tests.
 *
 * It validates the request the way the real API documents itself
 * (https://docs.typesafe.ai/api) — required `state`/`model`/`questions`,
 * per-primitive `criteria` shapes, Bearer auth — and answers fixture posts with
 * hand-written jev-shaped payloads. Serving it over HTTP also gives us the
 * fixture "LinkedIn" page the content script is tested against.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const NAMES = { golden_nugget: "golden_nugget", useful: "useful", slop: "slop" };

/** Hand-authored jev answers per fixture post, keyed by a text fingerprint. */
function profileFor(text) {
  const t = (text ?? "").toLowerCase();
  if (/comment\s+("|')?yes|drop a\s+("|')?yes|agree\?|thoughts\?/.test(t)) {
    return {
      verdict: { choice: "slop", probabilities: { slop: 0.86, useful: 0.11, golden_nugget: 0.03 }, confidence: 0.83 },
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
  }
  if (/p99|latency|rewrote|benchmark|index scan/.test(t)) {
    return {
      verdict: { choice: "golden_nugget", probabilities: { golden_nugget: 0.82, useful: 0.16, slop: 0.02 }, confidence: 0.79 },
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
  }
  return {
    verdict: { choice: "useful", probabilities: { useful: 0.7, golden_nugget: 0.15, slop: 0.15 }, confidence: 0.66 },
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
}

function answerFor(id, profile) {
  if (id === "verdict") {
    return {
      type: "choice",
      choice: profile.verdict.choice,
      probabilities: profile.verdict.probabilities,
      confidence: profile.verdict.confidence,
    };
  }
  if (id === "infoDensity") {
    return {
      type: "score",
      score: profile.infoDensity,
      confidence: 0.8,
      legend: { 0: "Nothing", 1: "Thin", 2: "Moderate", 3: "Dense", 4: "Very dense" },
      probabilities: { 0: 0.05, 1: 0.05, 2: 0.1, 3: 0.6, 4: 0.2 },
    };
  }
  return { type: "noul", noul: profile[id] ?? 0.5 };
}

/** Validate the payload the way the documented API would, so tests catch drift. */
export function validateRequest(body) {
  const errors = [];
  if (!body || typeof body !== "object") return ["body is not JSON"];
  if (!body.model) errors.push("model is required");
  if (!body.state || typeof body.state !== "object") errors.push("state must be an object");
  if (!body.questions || typeof body.questions !== "object") errors.push("questions must be a map");
  for (const [id, question] of Object.entries(body.questions ?? {})) {
    if (!["noul", "choice", "score"].includes(question?.type)) errors.push(`${id}: invalid type`);
    if (!question?.instructions) errors.push(`${id}: instructions are required`);
    if (question?.type === "choice") {
      const options = Object.keys(question.criteria ?? {});
      if (!options.length) errors.push(`${id}: choice requires criteria options`);
      if (options.length > 255) errors.push(`${id}: too many options`);
    }
    if (question?.type === "score") {
      if (!Array.isArray(question.criteria)) errors.push(`${id}: score criteria must be an array`);
      else if (question.criteria.length < 2 || question.criteria.length > 10) errors.push(`${id}: score needs 2-10 levels`);
    }
  }
  return errors;
}

export async function readFixture(name = "linkedin-feed") {
  return readFile(resolve(here, `fixtures/${name}.html`), "utf8");
}

/**
 * A feed page with no posts at all — used to prove the extension says so out loud
 * instead of failing silently when LinkedIn's markup drifts.
 */
const EMPTY_FEED = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Feed | LinkedIn</title></head>
<body><div id="root"><main><div class="scaffold-finite-scroll__content" data-testid="mainFeed"></div></main></div></body></html>`;

export async function startMockServer() {
  const fixture = await readFixture();
  const obfuscated = await readFixture("linkedin-feed-obfuscated");
  const sdui = await readFixture("linkedin-feed-sdui");
  const requests = [];
  let scenario = { mode: "ok" };
  let rateLimitedSoFar = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (status, payload, type = "application/json") => {
      res.writeHead(status, { "content-type": type, "access-control-allow-origin": "*" });
      res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
    };

    if (req.method === "GET" && url.pathname === "/") return send(200, fixture, "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/obfuscated") return send(200, obfuscated, "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/sdui") return send(200, sdui, "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/empty") return send(200, EMPTY_FEED, "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/__requests") return send(200, requests);
    if (req.method === "POST" && url.pathname === "/__reset") {
      requests.length = 0;
      rateLimitedSoFar = 0;
      scenario = { mode: "ok" };
      return send(200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/__scenario") {
      scenario = { mode: url.searchParams.get("mode") ?? "ok" };
      rateLimitedSoFar = 0;
      return send(200, { ok: true, scenario });
    }

    if (req.method === "POST" && url.pathname === "/v1/systemone") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(422, { error: { message: "invalid JSON" } });
      }
      requests.push({ path: url.pathname, headers: req.headers, body, at: Date.now() });

      if (!/^Bearer .+/.test(req.headers.authorization ?? "")) {
        return send(401, { error: { message: "missing bearer token" } });
      }
      const errors = validateRequest(body);
      if (errors.length) return send(422, { error: { message: `validation failed: ${errors.join("; ")}` }, errors });

      if (scenario.mode === "ratelimit" && rateLimitedSoFar < 2) {
        rateLimitedSoFar++;
        res.writeHead(429, { "content-type": "application/json", "retry-after": "0" });
        return res.end(JSON.stringify({ error: { message: "rate limited" } }));
      }
      if (scenario.mode === "server-error") return send(500, { error: { message: "boom" } });
      if (scenario.mode === "auth") return send(401, { error: { message: "invalid api key" } });

      const state = body.state ?? {};
      const text = typeof state === "string" ? state : (state.post?.text ?? "");
      const profile = profileFor(text);
      const answers = {};
      for (const id of Object.keys(body.questions ?? {})) answers[id] = answerFor(id, profile);

      if (scenario.mode === "uncertain") {
        // Strong underlying signals, but the model cannot separate the three verdicts.
        answers.verdict = {
          type: "choice",
          choice: "golden_nugget",
          probabilities: { golden_nugget: 0.34, useful: 0.33, slop: 0.33 },
          confidence: 0.2,
        };
      }

      return send(200, {
        model: "jev-1.13.0",
        answers,
        usage: { input_tokens: 512, output_tokens: 64 },
      });
    }

    send(404, { error: { message: "not found" } });
  });

  await new Promise((resolve_) => server.listen(0, "127.0.0.1", resolve_));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    endpoint: `http://127.0.0.1:${port}/v1/systemone`,
    fixtureUrl: `http://127.0.0.1:${port}/`,
    requests,
    reset: async () => {
      requests.length = 0;
      rateLimitedSoFar = 0;
      scenario = { mode: "ok" };
    },
    setScenario: (mode) => {
      scenario = { mode };
      rateLimitedSoFar = 0;
    },
    close: () => new Promise((resolve_) => server.close(resolve_)),
    NAMES,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await startMockServer();
  console.log(`mock type-safe server on ${server.url}`);
}
