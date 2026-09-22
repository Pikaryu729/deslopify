import { ClassifyError } from "../shared/messages.js";

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 522, 524, 529]);
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ATTEMPTS = 3;

const trimSlash = (url) => url.replace(/\/+$/, "");

/**
 * Build the concrete HTTP request for the configured provider.
 * Both providers expose jev with the same request/response semantics; only the
 * envelope differs, so adapters stay tiny.
 */
export function buildRequest(settings, { state, questions }) {
  if (settings.provider === "cloudflare") {
    const accountId = (settings.cloudflareAccountId || "").trim();
    if (!accountId) throw new ClassifyError("Cloudflare account ID is not set", { code: "config" });
    if (!settings.cloudflareApiToken) throw new ClassifyError("Cloudflare API token is not set", { code: "config" });
    return {
      url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`,
      headers: {
        Authorization: `Bearer ${settings.cloudflareApiToken}`,
        "Content-Type": "application/json",
      },
      body: { model: settings.cloudflareModel || "typesafe/jev", input: { state, questions } },
      parse: parseCloudflareResponse,
    };
  }

  if (!settings.apiKey) throw new ClassifyError("No TypeSafe API key set — open Deslopify options", { code: "config" });
  return {
    url: trimSlash(settings.baseUrl || "https://api.typesafe.ai/v1/systemone"),
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: { state, model: settings.model || "jev-latest", questions },
    parse: parseTypeSafeResponse,
  };
}

export function parseTypeSafeResponse(json) {
  if (!json || typeof json !== "object") {
    throw new ClassifyError("TypeSafe returned an empty response", { code: "bad_response" });
  }
  if (!json.answers) {
    const detail = json.error?.message || json.message || JSON.stringify(json).slice(0, 200);
    throw new ClassifyError(`TypeSafe response had no answers: ${detail}`, { code: "bad_response" });
  }
  return { answers: json.answers, usage: json.usage ?? null, model: json.model ?? null };
}

export function parseCloudflareResponse(json) {
  const payload = json?.result ?? json;
  let shaped = payload;
  if (typeof payload === "string") {
    try {
      shaped = JSON.parse(payload);
    } catch {
      throw new ClassifyError("Cloudflare returned a non-JSON result", { code: "bad_response" });
    }
  } else if (payload && typeof payload.response === "string") {
    try {
      shaped = JSON.parse(payload.response);
    } catch {
      shaped = payload;
    }
  }
  if (!shaped?.answers) {
    const detail = json?.errors?.[0]?.message || "missing answers";
    throw new ClassifyError(`Cloudflare Workers AI error: ${detail}`, { code: "bad_response" });
  }
  return { answers: shaped.answers, usage: shaped.usage ?? null, model: shaped.model ?? null };
}

/** Map an HTTP status + body into a typed ClassifyError. */
export function httpError(status, bodyText) {
  const detail = (bodyText || "").slice(0, 300);
  const retryable = RETRYABLE_STATUSES.has(status);
  const byStatus = {
    400: ["bad_request", "TypeSafe rejected the request"],
    401: ["auth", "TypeSafe rejected the API key (401)"],
    403: ["auth", "TypeSafe denied access (403)"],
    404: ["bad_request", "Endpoint not found — check the API URL in options"],
    413: ["bad_request", "Request too large — lower the max post length"],
    422: ["bad_request", "TypeSafe could not validate the question payload"],
    429: ["rate_limited", "Rate limited by TypeSafe (429)"],
    529: ["overloaded", "TypeSafe is overloaded (529)"],
  };
  const [code, message] = byStatus[status] ?? [`http_${status}`, `Request failed with HTTP ${status}`];
  return new ClassifyError(detail ? `${message} — ${detail}` : message, { code, status, retryable });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryDelayMs(attempt, response) {
  const retryAfter = Number(response?.headers?.get?.("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 20_000);
  const base = 500 * 2 ** attempt;
  return Math.min(base + Math.random() * base * 0.5, 15_000);
}

/**
 * POST a system-one request with timeouts, and exponential backoff on
 * 429/529/5xx/network failures (per https://docs.typesafe.ai/api#handling-rate-limits).
 */
export async function callJev(settings, { state, questions }, options = {}) {
  const { url, headers, body, parse } = buildRequest(settings, { state, questions });
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const error = httpError(response.status, text);
        if (error.retryable && attempt < attempts - 1) {
          lastError = error;
          await sleep(retryDelayMs(attempt, response));
          continue;
        }
        throw error;
      }
      const json = await response.json();
      return { ...parse(json), attempts: attempt + 1 };
    } catch (error) {
      const normalised =
        error instanceof ClassifyError
          ? error
          : error?.name === "AbortError"
            ? new ClassifyError(`Request timed out after ${timeoutMs} ms`, { code: "timeout", retryable: true })
            : new ClassifyError(error?.message || "Network request failed", { code: "network", retryable: true });
      if (normalised.retryable && attempt < attempts - 1) {
        lastError = normalised;
        await sleep(retryDelayMs(attempt));
        continue;
      }
      throw normalised;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new ClassifyError("Request failed", { code: "unknown" });
}
