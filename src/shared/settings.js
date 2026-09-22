import ext, { hasExt } from "./webext.js";

export const STORAGE_KEYS = {
  settings: "deslopify:settings",
  stats: "deslopify:stats",
  tabs: "deslopify:tabs",
  cachePrefix: "deslopify:cache:",
};

export const VERDICTS = ["golden_nugget", "useful", "slop"];

export const VERDICT_META = {
  golden_nugget: { label: "Golden nugget", short: "Nugget", color: "#f0b429" },
  useful: { label: "Useful", short: "Useful", color: "#2f9e6f" },
  slop: { label: "Slop", short: "Slop", color: "#d9534f" },
};

export const DEFAULT_SETTINGS = {
  enabled: true,

  // Score posts locally with the demo classifier: no API key, no network requests.
  demoMode: false,

  // --- provider ---------------------------------------------------------
  provider: "typesafe", // "typesafe" | "cloudflare"
  apiKey: "",
  model: "jev-latest",
  baseUrl: "https://api.typesafe.ai/v1/systemone",
  cloudflareAccountId: "",
  cloudflareApiToken: "",
  cloudflareModel: "typesafe/jev",

  // --- what the reader cares about --------------------------------------
  interests:
    "Building software products, AI/LLM engineering, startups, developer tooling, and hard-won engineering lessons.",
  slopTriggers:
    "Engagement farming, 'comment YES to get my PDF', fake vulnerability, motivational filler, generic AI-written listicles with no first-hand detail, and pure product pitching with nothing to learn.",
  nuggetDefinition:
    "First-hand specifics, non-obvious claims backed by evidence, real numbers, working code or technique, and lessons from something the author actually did.",

  // --- verdict math ------------------------------------------------------
  // score is normalised to [-1, 1]; nugget >= nuggetThreshold, slop <= slopThreshold.
  nuggetThreshold: 0.34,
  slopThreshold: -0.22,
  strictNuggetWithoutRelevance: 0.55,
  minConfidence: 0.55,
  weights: {
    modelLean: 0.45,
    quality: 0.3,
    density: 0.1,
    slopSignals: 0.25,
    promotional: 0.15,
    relevance: 0.1,
  },

  // --- UI ----------------------------------------------------------------
  showBadges: true,
  dimSlop: false,
  hideSlop: false,
  showPending: true,
  badgeStyle: "pill", // "pill" | "dot"
  maxTextChars: 3500,

  // --- throughput --------------------------------------------------------
  concurrency: 2,
  requestsPerMinute: 40,
  cacheMaxEntries: 600,
  cacheTtlDays: 30,
};

/** Why Deslopify cannot work right now, in words a user can act on. */
export function configProblem(settings) {
  if (settings.demoMode) return null; // demo mode needs nothing
  if (settings.provider === "cloudflare") {
    if (!settings.cloudflareAccountId) return "Deslopify needs a Cloudflare account ID (settings → Model access).";
    if (!settings.cloudflareApiToken) return "Deslopify needs a Cloudflare API token (settings → Model access).";
    return null;
  }
  if (!settings.apiKey) return "Deslopify needs a TypeSafe API key before it can score posts (settings → Model access).";
  if (!/^https?:\/\/.+/.test(settings.baseUrl ?? "")) {
    return "Deslopify's endpoint URL is not a valid http(s) URL (settings → Advanced).";
  }
  return null;
}

/** Redacted config summary, safe to paste into a bug report. */
export function describeConfig(settings) {
  return {
    provider: settings.provider,
    model: settings.provider === "cloudflare" ? settings.cloudflareModel : settings.model,
    endpoint: settings.provider === "cloudflare" ? "api.cloudflare.com (Workers AI)" : settings.baseUrl,
    credentialSet: settings.provider === "cloudflare" ? Boolean(settings.cloudflareApiToken) : Boolean(settings.apiKey),
    demoMode: Boolean(settings.demoMode),
    enabled: settings.enabled,
    thresholds: {
      nugget: settings.nuggetThreshold,
      slop: settings.slopThreshold,
      minConfidence: settings.minConfidence,
    },
    problem: configProblem(settings),
  };
}

/** Deep-ish merge that only accepts known keys, so a stale stored blob can't inject junk. */
export function mergeSettings(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!(key in base)) continue;
    if (value && typeof value === "object" && !Array.isArray(value) && typeof base[key] === "object") {
      out[key] = { ...base[key], ...value };
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

export async function loadSettings() {
  const stored = await ext.storage.local.get(STORAGE_KEYS.settings);
  return mergeSettings(DEFAULT_SETTINGS, stored?.[STORAGE_KEYS.settings]);
}

export async function saveSettings(settings) {
  const merged = mergeSettings(DEFAULT_SETTINGS, settings);
  await ext.storage.local.set({ [STORAGE_KEYS.settings]: merged });
  return merged;
}

export async function patchSettings(patch) {
  const current = await loadSettings();
  return saveSettings(mergeSettings(current, patch));
}

/**
 * Sub-second settings cache. The content script reads settings on every post,
 * and `storage.local.get` across a message boundary is too slow for that path.
 */
let cached = null;
let cachedAt = 0;
const TTL_MS = 2_000;

export async function getSettingsCached() {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return cached;
  cached = await loadSettings();
  cachedAt = now;
  return cached;
}

export function invalidateSettingsCache() {
  cached = null;
  cachedAt = 0;
}

if (hasExt()) {
  ext.storage.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEYS.settings]) invalidateSettingsCache();
  });
}
