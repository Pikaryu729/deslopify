import ext from "../shared/webext.js";
import { ClassifyError, MSG, fail, ok } from "../shared/messages.js";
import {
  describeConfig,
  getSettingsCached,
  invalidateSettingsCache,
  loadSettings,
  patchSettings,
  STORAGE_KEYS,
} from "../shared/settings.js";
import { buildQuestions, buildState } from "../shared/rubric.js";
import { computeVerdict } from "../shared/verdict.js";
import { demoAnswers } from "../shared/demo.js";
import { callJev } from "./api.js";
import {
  cacheDelete,
  cacheGet,
  cacheKeyFor,
  cacheSet,
  cacheSize,
  clearCache,
  flushCacheHits,
  pruneCache,
} from "./cache.js";

/* ------------------------------------------------------------------ queue */

/**
 * Bounded worker pool with a sliding-window request budget, so a fast scroll
 * through a long feed cannot hammer the API (or the user's rate limit).
 */
class TaskQueue {
  constructor(limits) {
    this.limits = limits;
    this.queue = [];
    this.active = 0;
    this.recentStarts = [];
  }

  setLimits(limits) {
    this.limits = { ...this.limits, ...limits };
    this.#drain();
  }

  get size() {
    return this.queue.length + this.active;
  }

  add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.#drain();
    });
  }

  #msUntilBudget() {
    const now = Date.now();
    const windowMs = 60_000;
    this.recentStarts = this.recentStarts.filter((t) => now - t < windowMs);
    const limit = this.limits.requestsPerMinute;
    if (!limit || this.recentStarts.length < limit) return 0;
    return Math.max(0, windowMs - (now - this.recentStarts[0]) + 5);
  }

  async #drain() {
    while (this.active < this.limits.concurrency && this.queue.length) {
      const wait = this.#msUntilBudget();
      if (wait > 0) {
        setTimeout(() => this.#drain(), wait);
        return;
      }
      const { task, resolve, reject } = this.queue.shift();
      this.active++;
      this.recentStarts.push(Date.now());
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          this.active--;
          this.#drain();
        });
    }
  }
}

/* ------------------------------------------------------------------ stats */

const EMPTY_STATS = {
  verdicts: { golden_nugget: 0, useful: 0, slop: 0 },
  requests: 0,
  cacheHits: 0,
  apiCalls: 0,
  tokens: { input_tokens: 0, output_tokens: 0 },
  errors: 0,
  lastError: null,
  lastVerdictAt: null,
  since: Date.now(),
};

let stats = null;
let statsDirty = false;

async function loadStats() {
  if (stats) return stats;
  const stored = await ext.storage.local.get(STORAGE_KEYS.stats);
  stats = { ...EMPTY_STATS, ...(stored?.[STORAGE_KEYS.stats] ?? {}) };
  return stats;
}

let flushTimer = null;
function scheduleFlush() {
  statsDirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    if (!statsDirty || !stats) return;
    statsDirty = false;
    await ext.storage.local.set({ [STORAGE_KEYS.stats]: stats });
    await flushCacheHits();
  }, 1_500);
}

async function recordVerdict(result, { cached, apiCall }) {
  const s = await loadStats();
  s.verdicts[result.verdict] = (s.verdicts[result.verdict] ?? 0) + 1;
  s.requests += 1;
  s.cacheHits += cached ? 1 : 0;
  s.apiCalls += apiCall ? 1 : 0;
  s.lastVerdictAt = Date.now();
  if (result.usage) {
    s.tokens.input_tokens += result.usage.input_tokens ?? 0;
    s.tokens.output_tokens += result.usage.output_tokens ?? 0;
  }
  scheduleFlush();
}

async function recordError(error) {
  const s = await loadStats();
  s.errors += 1;
  s.lastError = { message: String(error?.message ?? error), code: error?.code ?? "unknown", at: Date.now() };
  scheduleFlush();
}

/* ------------------------------------------------------------------ worker */

const queue = new TaskQueue({ concurrency: 2, requestsPerMinute: 40 });
const inFlight = new Map();
let settings = null;

async function getSettings() {
  if (!settings) settings = await loadSettings();
  return settings;
}

async function refreshSettings() {
  invalidateSettingsCache();
  settings = await loadSettings();
  queue.setLimits({ concurrency: settings.concurrency, requestsPerMinute: settings.requestsPerMinute });
  return settings;
}

/**
 * Classify one post. Deduplicates concurrent demands for the same post and
 * serves cached verdicts without touching the network.
 */
async function classify(post, { force = false } = {}) {
  const current = await getSettings();
  const cacheKey = cacheKeyFor(post, current);

  if (force) await cacheDelete(cacheKey);
  else {
    const hit = await cacheGet(cacheKey);
    if (hit?.result) {
      await recordVerdict(hit.result, { cached: true, apiCall: false });
      return { result: hit.result, cached: true };
    }
  }

  if (inFlight.has(cacheKey)) {
    const result = await inFlight.get(cacheKey);
    return { result, cached: false, deduped: true };
  }

  const run = queue.add(async () => {
    const live = await getSettings();

    // Demo mode: same rubric, same verdict math, no network at all.
    if (live.demoMode) {
      const answers = demoAnswers(post, live);
      const result = computeVerdict(answers, live, {
        model: "demo (local heuristic — no model, no network)",
        usage: null,
      });
      result.demo = true;
      return result;
    }

    const state = buildState(post, live);
    const questions = buildQuestions(live);
    const { answers, usage, model } = await callJev(live, { state, questions });
    const result = computeVerdict(answers, live, { model, usage });
    result.answers = answers;
    return result;
  });

  inFlight.set(cacheKey, run);
  try {
    const result = await run;
    // `answers` is useful in the live response (Copy JSON in the panel) but it is
    // the bulk of the payload, so the cache stores the derived verdict only.
    const { answers: _answers, ...cacheable } = result;
    await cacheSet(cacheKey, cacheable, current);
    await recordVerdict(result, { cached: false, apiCall: true });
    return { result, cached: false };
  } finally {
    inFlight.delete(cacheKey);
  }
}

/** Cheap round-trip that proves the key/endpoint work and reports the live model. */
async function testConnection() {
  const current = await getSettings();
  if (current.demoMode) {
    return { model: "demo (local heuristic — no model, no network)", demo: true, latencyMs: 0, usage: null, provider: "demo" };
  }
  const started = Date.now();
  const { answers, model, usage } = await callJev(
    current,
    {
      state: "Deslopify connection test.",
      questions: {
        ok: { type: "noul", instructions: "Is this a connection test?" },
      },
    },
    { attempts: 1, timeoutMs: 20_000 },
  );
  return { model, answers, usage, latencyMs: Date.now() - started, provider: current.provider };
}

/* -------------------------------------------------------- tab registry */

/**
 * Content scripts announce themselves so the popup can ask "what are you seeing
 * on that tab?" without the extension holding the broad `tabs` permission.
 * Registrations are stored so they survive an MV3 worker restart, and are
 * validated on use: a dead or navigated-away tab is dropped silently.
 */
const REGISTRATION_TTL_MS = 6 * 60 * 60 * 1000;

async function registerTab(sender, payload) {
  const tabId = sender?.tab?.id;
  if (typeof tabId !== "number") return ok({ registered: false });
  const stored = await ext.storage.local.get(STORAGE_KEYS.tabs);
  const tabs = stored?.[STORAGE_KEYS.tabs] ?? {};
  tabs[tabId] = { url: payload?.url ?? sender.tab.url ?? null, at: Date.now() };
  await ext.storage.local.set({ [STORAGE_KEYS.tabs]: tabs });
  return ok({ registered: true, tabId });
}

async function collectPageStatuses() {
  const stored = await ext.storage.local.get(STORAGE_KEYS.tabs);
  const registrations = stored?.[STORAGE_KEYS.tabs] ?? {};
  const now = Date.now();
  const candidates = Object.entries(registrations)
    .filter(([, entry]) => now - (entry.at ?? 0) < REGISTRATION_TTL_MS)
    .sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0));

  const statuses = [];
  const stale = [];
  for (const [tabId, entry] of candidates) {
    try {
      const status = await ext.tabs.sendMessage(Number(tabId), { type: MSG.PAGE_STATUS });
      if (status) statuses.push({ tabId: Number(tabId), url: entry.url, status });
    } catch {
      stale.push(tabId); // tab closed, navigated away, or extension reloaded
    }
  }
  if (stale.length) {
    const remaining = { ...registrations };
    for (const tabId of stale) delete remaining[tabId];
    await ext.storage.local.set({ [STORAGE_KEYS.tabs]: remaining });
  }
  return statuses;
}

/* ------------------------------------------------------------- messaging */

async function handle(message) {
  switch (message?.type) {
    case MSG.PING:
      return ok({ pong: true });

    case MSG.CLASSIFY: {
      if (!message.post?.text) return fail("Post has no text", "empty");
      const { result, cached, deduped } = await classify(message.post, { force: message.force });
      return ok({ result, cached: Boolean(cached), deduped: Boolean(deduped) });
    }

    case MSG.RELOAD_SETTINGS:
      return ok({ settings: await refreshSettings() });

    case MSG.PATCH_SETTINGS: {
      const updated = await patchSettings(message.patch ?? {});
      settings = updated;
      queue.setLimits({ concurrency: updated.concurrency, requestsPerMinute: updated.requestsPerMinute });
      // Verdicts cached under the old settings would be stale (illustrated by the
      // cache key including the settings fingerprint), so drop them on a switch.
      if (message.clearCache) await clearCache();
      return ok({ settings: updated });
    }

    case MSG.GET_STATS: {
      const s = await loadStats();
      return ok({
        stats: { ...s, queue: queue.size, cacheEntries: await cacheSize() },
      });
    }

    case MSG.RESET_STATS:
      stats = { ...EMPTY_STATS, since: Date.now() };
      await ext.storage.local.set({ [STORAGE_KEYS.stats]: stats });
      return ok({ stats });

    case MSG.CLEAR_CACHE: {
      const removed = await clearCache();
      return ok({ removed });
    }

    case MSG.TEST_CONNECTION:
      return ok({ connection: await testConnection() });

    case MSG.OPEN_OPTIONS:
      await ext.runtime.openOptionsPage();
      return ok({});

    case MSG.REGISTER_TAB:
      return registerTab(message.sender, message.payload);

    case MSG.GET_PAGE_STATUS: {
      const pages = await collectPageStatuses();
      const active = pages.find((page) => page.status?.enabled) ?? pages[0] ?? null;
      return ok({ page: active, pages });
    }

    case MSG.GET_CONFIG:
      return ok({ config: describeConfig(await getSettings()) });

    case MSG.DIAGNOSE: {
      const current = await getSettings();
      const pages = await collectPageStatuses();
      const reports = [];
      for (const page of pages) {
        try {
          reports.push(await ext.tabs.sendMessage(page.tabId, { type: MSG.DIAGNOSE }));
        } catch {
          /* tab went away between listing and asking */
        }
      }
      return ok({
        version: ext.runtime.getManifest?.().version ?? null,
        userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
        config: describeConfig(current),
        stats: { ...(await loadStats()), queue: queue.size, cacheEntries: await cacheSize() },
        pages: reports,
      });
    }

    default:
      return fail(`Unknown message type: ${message?.type}`, "unknown_message");
  }
}

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle({ ...message, sender })
    .then(sendResponse)
    .catch(async (error) => {
      if (error?.code !== "config") await recordError(error);
      sendResponse(fail(error, error?.code));
    });
  return true; // keep the channel open for the async response
});

ext.tabs?.onRemoved?.addListener(async (tabId) => {
  const stored = await ext.storage.local.get(STORAGE_KEYS.tabs);
  const tabs = stored?.[STORAGE_KEYS.tabs];
  if (!tabs || !(tabId in tabs)) return;
  delete tabs[tabId];
  await ext.storage.local.set({ [STORAGE_KEYS.tabs]: tabs });
});

/* ------------------------------------------------------------- lifecycle */

ext.runtime.onInstalled?.addListener(async () => {
  await refreshSettings();
  await pruneCache((await getSettings()).cacheMaxEntries);
});

ext.runtime.onStartup?.addListener(() => refreshSettings());

ext.storage.onChanged?.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEYS.settings]) {
    invalidateSettingsCache();
    settings = null;
    refreshSettings();
  }
});

// Prune + persist counters periodically; also keeps a sleeping MV3 worker honest.
setInterval(async () => {
  const current = await getSettings().catch(() => null);
  if (current) await pruneCache(current.cacheMaxEntries).catch(() => {});
  await flushCacheHits().catch(() => {});
}, 5 * 60_000);

refreshSettings().catch(() => {});

// Exported for unit tests (bundled builds never import the background entry).
export { classify, queue, TaskQueue };
