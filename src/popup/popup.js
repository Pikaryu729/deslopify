import ext from "../shared/webext.js";
import { MSG } from "../shared/messages.js";
import { getSettingsCached, patchSettings } from "../shared/settings.js";
import { applyToForm, onFormChange, readForm } from "../shared/form.js";

const $ = (id) => document.getElementById(id);

let settings = null;
let saveTimer = null;

function status(message, kind = "") {
  const node = $("status");
  node.textContent = message;
  node.className = `status ${kind}`;
}

async function renderStats() {
  const response = await ext.runtime.sendMessage({ type: MSG.GET_STATS });
  if (!response?.ok) return;
  const { stats } = response;
  $("count-nugget").textContent = stats.verdicts.golden_nugget ?? 0;
  $("count-useful").textContent = stats.verdicts.useful ?? 0;
  $("count-slop").textContent = stats.verdicts.slop ?? 0;
  $("usage").textContent = `${stats.apiCalls} API calls · ${stats.cacheHits} from cache · ${
    stats.tokens.input_tokens + stats.tokens.output_tokens
  } tokens · ${stats.cacheEntries} cached posts`;
  if (stats.lastError) {
    $("last-error").hidden = false;
    $("last-error").textContent = `Last error: ${stats.lastError.message}`;
  }
}

/**
 * Ask the background worker what the content script on a LinkedIn tab sees.
 * The worker knows which tabs registered, so the extension never needs the
 * broad `tabs` permission just to fill in this line of diagnostics.
 */
async function renderPageStatus() {
  const node = $("page-status");
  try {
    const response = await ext.runtime.sendMessage({ type: MSG.GET_PAGE_STATUS });
    const page = response?.page;
    if (!page) {
      node.textContent =
        "No Deslopify script on a LinkedIn tab. Open your feed, or reload the tab (Ctrl+R / ⌘R) so the extension can attach.";
      return;
    }
    const { status } = page;
    const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;
    node.textContent =
      `On the LinkedIn tab: ${status.postsFound} posts found, ` +
      `${plural(status.byVerdict.golden_nugget, "nugget")}, ${status.byVerdict.useful} useful, ` +
      `${status.byVerdict.slop} slop` +
      (status.pending ? `, ${status.pending} in flight` : "") +
      (status.waiting ? `, ${status.waiting} not scrolled into view yet` : "") +
      (status.skipped ? `, ${status.skipped} without text` : "") +
      (status.errors ? `, ${status.errors} failed` : "");
  } catch (error) {
    node.textContent = `Could not read page status: ${error.message}`;
  }
}

/** Surface "why nothing is happening" without the user having to dig. */
async function renderConfigWarning() {
  try {
    const response = await ext.runtime.sendMessage({ type: MSG.GET_CONFIG });
    const problem = response?.config?.problem;
    if (!problem) return;
    $("config-problem").textContent = problem;
    $("config-warning").hidden = false;
  } catch {
    $("config-problem").textContent = "Deslopify's background worker is not responding — try reloading the extension.";
    $("config-warning").hidden = false;
  }
}

/** One-click bug report: config, counters, and the live DOM report from the tab. */
async function copyDiagnostics() {
  const button = $("copy-diagnostics");
  try {
    const response = await ext.runtime.sendMessage({ type: MSG.DIAGNOSE });
    const payload = JSON.stringify(response?.ok ? response : { error: response?.error }, null, 1);
    console.info("[Deslopify] diagnostics\n" + payload);
    await navigator.clipboard.writeText(payload);
    status("Diagnostics copied to clipboard");
  } catch (error) {
    status(`Could not copy diagnostics: ${error.message}`, "err");
  } finally {
    button.blur();
  }
}

async function init() {
  settings = await getSettingsCached();
  applyToForm(document, settings);
  $("no-key").hidden = settings.provider === "typesafe" ? Boolean(settings.apiKey) : Boolean(settings.cloudflareApiToken);

  $("enabled").addEventListener("change", (event) => {
    status(event.target.checked ? "Highlighting on" : "Highlighting off");
  });

  onFormChange(document, (patch) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      settings = await patchSettings(patch);
      status("Saved");
      setTimeout(() => status(""), 1200);
    }, 250);
  });

  $("open-options").addEventListener("click", () => ext.runtime.openOptionsPage());
  $("open-options-key").addEventListener("click", () => ext.runtime.openOptionsPage());

  $("clear-cache").addEventListener("click", async () => {
    const response = await ext.runtime.sendMessage({ type: MSG.CLEAR_CACHE });
    status(response?.ok ? `Cleared ${response.removed} cached verdicts` : "Could not clear cache", response?.ok ? "ok" : "err");
    renderStats();
  });

  $("copy-diagnostics").addEventListener("click", copyDiagnostics);

  await renderStats();
  await renderPageStatus();
  await renderConfigWarning();
}

init().catch((error) => status(error.message, "err"));
