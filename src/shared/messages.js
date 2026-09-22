/** Message protocol between content script / popup / options and the background worker. */

export const MSG = {
  CLASSIFY: "classify",
  RELOAD_SETTINGS: "settings:reload",
  CLEAR_CACHE: "cache:clear",
  GET_STATS: "stats:get",
  RESET_STATS: "stats:reset",
  TEST_CONNECTION: "connection:test",
  OPEN_OPTIONS: "options:open",
  PAGE_STATUS: "page:status",
  REGISTER_TAB: "tabs:register",
  GET_PAGE_STATUS: "tabs:pageStatus",
  GET_CONFIG: "config:get",
  DIAGNOSE: "diagnostics:collect",
  PING: "ping",
};

/** Every response is `{ ok: true, ...payload }` or `{ ok: false, error, code? }`. */
export function ok(payload = {}) {
  return { ok: true, ...payload };
}

export function fail(error, code) {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  return { ok: false, error: message, code };
}

export class ClassifyError extends Error {
  constructor(message, { code = "unknown", retryable = false, status } = {}) {
    super(message);
    this.name = "ClassifyError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}
