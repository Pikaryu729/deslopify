/**
 * Small, dependency-free hashes. Used for cache keys, never for security.
 */

/** FNV-1a 32-bit, returned as 8 lowercase hex chars. */
export function fnv1a32(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash *= 16777619, kept in 32-bit range without BigInt
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * 64-bit-ish content digest: two independently seeded FNV-1a passes.
 * Collision risk is irrelevant for a post-level cache (~2^-64 for our sizes).
 */
export function digest(input) {
  return fnv1a32(input) + fnv1a32("deslopify\u0000" + input + "\u0000" + input.length);
}

/** Stable stringify so cache keys don't depend on property order. */
export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
}
