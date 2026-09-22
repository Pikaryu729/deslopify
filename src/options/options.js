import ext from "../shared/webext.js";
import { MSG } from "../shared/messages.js";
import { DEFAULT_SETTINGS, getSettingsCached, saveSettings } from "../shared/settings.js";
import { applyToForm, onFormChange, readForm } from "../shared/form.js";

const $ = (id) => document.getElementById(id);

let saveTimer = null;
let testTimer = null;

function setStatus(node, message, kind = "") {
  node.textContent = message;
  node.className = `status ${kind}`;
}

function syncProviderFields(settings) {
  $("typesafe-fields").hidden = settings.provider !== "typesafe";
  $("cloudflare-fields").hidden = settings.provider !== "cloudflare";
}

async function refreshDataSummary() {
  const response = await ext.runtime.sendMessage({ type: MSG.GET_STATS });
  if (!response?.ok) return;
  const { stats } = response;
  $("data-summary").textContent =
    `${stats.cacheEntries} cached verdicts · ${stats.apiCalls} API calls · ${stats.cacheHits} cache hits · ` +
    `${stats.tokens.input_tokens + stats.tokens.output_tokens} tokens used · ${stats.errors} errors` +
    (stats.lastError ? ` (last: ${stats.lastError.message})` : "");
}

async function testConnection() {
  const button = $("test");
  button.disabled = true;
  setStatus($("test-status"), "Calling jev…");
  try {
    const response = await ext.runtime.sendMessage({ type: MSG.TEST_CONNECTION });
    if (response?.ok) {
      const { model, latencyMs, usage } = response.connection;
      setStatus($("test-status"), `OK — ${model} answered in ${latencyMs} ms (${usage?.input_tokens ?? "?"} tokens)`, "ok");
    } else {
      setStatus($("test-status"), response?.error ?? "Failed", "err");
    }
  } catch (error) {
    setStatus($("test-status"), error.message, "err");
  } finally {
    button.disabled = false;
  }
}

async function init() {
  let settings = await getSettingsCached();
  applyToForm(document, settings);
  syncProviderFields(settings);
  refreshDataSummary();

  onFormChange(document, (patch) => {
    settings = { ...settings, ...patch };
    syncProviderFields({ ...settings, ...patch });
    clearTimeout(saveTimer);
    setStatus($("save-status"), "Saving…");
    saveTimer = setTimeout(async () => {
      const saved = await saveSettings(readForm(document));
      setStatus($("save-status"), "Saved", "ok");
      setTimeout(() => setStatus($("save-status"), ""), 1500);
      syncProviderFields(saved);
    }, 300);
  });

  $("test").addEventListener("click", testConnection);

  $("clear-cache").addEventListener("click", async () => {
    const response = await ext.runtime.sendMessage({ type: MSG.CLEAR_CACHE });
    setStatus($("save-status"), response?.ok ? `Cleared ${response.removed} verdicts` : "Clear failed", response?.ok ? "ok" : "err");
    refreshDataSummary();
  });

  $("reset-stats").addEventListener("click", async () => {
    await ext.runtime.sendMessage({ type: MSG.RESET_STATS });
    setStatus($("save-status"), "Counters reset", "ok");
    refreshDataSummary();
  });

  $("reset-settings").addEventListener("click", async () => {
    if (!confirm("Restore all Deslopify settings to defaults? Your API key will be cleared.")) return;
    const saved = await saveSettings({ ...DEFAULT_SETTINGS });
    applyToForm(document, saved);
    syncProviderFields(saved);
    setStatus($("save-status"), "Defaults restored", "ok");
  });

  // Keep the data summary fresh while the tab is open.
  clearInterval(testTimer);
  testTimer = setInterval(refreshDataSummary, 5000);
}

init().catch((error) => setStatus($("save-status"), error.message, "err"));
