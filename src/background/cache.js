import ext from "../shared/webext.js";
import { STORAGE_KEYS } from "../shared/settings.js";
import { RUBRIC_VERSION, VERDICT_VERSION } from "../shared/rubric.js";
import { digest, stableStringify } from "../shared/hash.js";

const PRUNE_EVERY_N_SETS = 25;

/** Everything that can change the answer must be part of the key. */
export function cacheKeyFor(post, settings) {
  const fingerprint = {
    rubric: RUBRIC_VERSION,
    verdict: VERDICT_VERSION,
    provider: settings.provider,
    demo: Boolean(settings.demoMode),
    model: settings.provider === "cloudflare" ? settings.cloudflareModel : settings.model,
    endpoint: settings.provider === "cloudflare" ? settings.cloudflareAccountId : settings.baseUrl,
    profile: {
      interests: settings.interests,
      slopTriggers: settings.slopTriggers,
      nuggetDefinition: settings.nuggetDefinition,
    },
    weights: settings.weights,
    thresholds: [settings.nuggetThreshold, settings.slopThreshold, settings.strictNuggetWithoutRelevance],
    post: {
      text: post.text,
      quotedText: post.quotedText ?? "",
      author: post.author,
      context: post.context,
      isPromoted: Boolean(post.isPromoted),
      isSuggested: Boolean(post.isSuggested),
      isRepost: Boolean(post.isRepost),
      hasMedia: Boolean(post.hasMedia),
      hasLink: Boolean(post.hasLink),
    },
  };
  return `${RUBRIC_VERSION}.${VERDICT_VERSION}.${digest(stableStringify(fingerprint))}`;
}

const keyFor = (cacheKey) => STORAGE_KEYS.cachePrefix + cacheKey;

let pendingHits = new Map();
let setsSincePrune = 0;

export async function cacheGet(cacheKey) {
  const storageKey = keyFor(cacheKey);
  const stored = await ext.storage.local.get(storageKey);
  const entry = stored?.[storageKey];
  if (!entry) return null;
  const ttlMs = entry.ttlDays * 86_400_000;
  if (entry.ttlDays && entry.ts && Date.now() - entry.ts > ttlMs) {
    await ext.storage.local.remove(storageKey);
    return null;
  }
  pendingHits.set(cacheKey, (pendingHits.get(cacheKey) ?? 0) + 1);
  return entry;
}

export async function cacheSet(cacheKey, result, settings) {
  const entry = {
    result,
    ts: Date.now(),
    ttlDays: Math.max(1, Number(settings.cacheTtlDays) || 30),
    verdict: result.verdict,
    hits: 0,
  };
  await ext.storage.local.set({ [keyFor(cacheKey)]: entry });
  if (++setsSincePrune >= PRUNE_EVERY_N_SETS) {
    setsSincePrune = 0;
    await pruneCache(settings.cacheMaxEntries);
  }
  return entry;
}

export async function cacheDelete(cacheKey) {
  await ext.storage.local.remove(keyFor(cacheKey));
}

/** Drop oldest-by-timestamp entries once over budget. */
export async function pruneCache(maxEntries = 600) {
  const all = await ext.storage.local.get(null);
  const entries = Object.entries(all)
    .filter(([key]) => key.startsWith(STORAGE_KEYS.cachePrefix))
    .map(([key, value]) => [key, value?.ts ?? 0]);
  if (entries.length <= maxEntries) return 0;
  entries.sort((a, b) => a[1] - b[1]);
  const doomed = entries.slice(0, entries.length - maxEntries).map(([key]) => key);
  await ext.storage.local.remove(doomed);
  return doomed.length;
}

export async function clearCache() {
  const all = await ext.storage.local.get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith(STORAGE_KEYS.cachePrefix));
  if (keys.length) await ext.storage.local.remove(keys);
  return keys.length;
}

export async function cacheSize() {
  const all = await ext.storage.local.get(null);
  return Object.keys(all).filter((key) => key.startsWith(STORAGE_KEYS.cachePrefix)).length;
}

/** Flush accumulated hit counters into the stored entries (called on an interval). */
export async function flushCacheHits() {
  if (!pendingHits.size) return;
  const hits = pendingHits;
  pendingHits = new Map();
  const keys = [...hits.keys()].map(keyFor);
  const stored = await ext.storage.local.get(keys);
  const patch = {};
  for (const [cacheKey, count] of hits) {
    const storageKey = keyFor(cacheKey);
    const entry = stored[storageKey];
    if (entry) patch[storageKey] = { ...entry, hits: (entry.hits ?? 0) + count };
  }
  if (Object.keys(patch).length) await ext.storage.local.set(patch);
}
