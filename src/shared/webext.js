/**
 * Cross-browser WebExtension namespace shim.
 *
 * Firefox exposes `browser.*` (promise based) and `chrome.*` (callback based).
 * Chrome MV3 exposes `chrome.*` with promise support for the APIs we use.
 * Prefer `browser`, fall back to `chrome`, and always use promise style.
 *
 * Resolution is lazy so that modules importing this file can still be unit
 * tested under node, where no WebExtension namespace exists.
 */
const g = /** @type {any} */ (globalThis);

let resolved = null;

function namespace() {
  if (resolved) return resolved;
  resolved = g.browser?.runtime?.id ? g.browser : g.chrome;
  if (!resolved) throw new Error("Deslopify: no WebExtension API namespace found");
  return resolved;
}

export const ext = new Proxy(
  {},
  {
    get: (_target, property) => {
      const value = namespace()[property];
      return typeof value === "function" ? value.bind(namespace()) : value;
    },
    has: (_target, property) => property in namespace(),
  },
);

/** True when running inside an extension context (false under plain node tests). */
export function hasExt() {
  return Boolean(g.browser?.runtime?.id || g.chrome?.runtime?.id);
}

export default ext;
