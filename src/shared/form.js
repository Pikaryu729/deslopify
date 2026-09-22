/**
 * Minimal two-way binding between a settings object and form controls marked
 * with `data-setting="path.to.key"`. Keeps popup/options pages free of
 * per-field boilerplate, and guarantees both pages read the same shape.
 */

export function getPath(object, path) {
  return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), object);
}

export function setPath(object, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  let target = object;
  for (const key of keys) {
    if (typeof target[key] !== "object" || target[key] === null) target[key] = {};
    target = target[key];
  }
  target[last] = value;
  return object;
}

function coerce(input, value) {
  const type = input.dataset.type ?? (input.type === "checkbox" ? "bool" : input.type === "number" || input.type === "range" ? "number" : "text");
  if (type === "bool") return Boolean(value);
  if (type === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }
  return value === undefined || value === null ? "" : String(value);
}

/** Fill every `[data-setting]` control under `root` from `settings`. */
export function applyToForm(root, settings) {
  for (const input of root.querySelectorAll("[data-setting]")) {
    const value = getPath(settings, input.dataset.setting);
    if (input.type === "checkbox") input.checked = Boolean(value);
    else if (value !== undefined && value !== null) input.value = String(value);
    const output = input.dataset.output ? root.querySelector(input.dataset.output) : null;
    if (output) output.textContent = input.type === "range" ? Number(input.value).toFixed(2) : input.value;
  }
}

/** Collect a patch object from every `[data-setting]` control under `root`. */
export function readForm(root) {
  const patch = {};
  for (const input of root.querySelectorAll("[data-setting]")) {
    setPath(patch, input.dataset.setting, coerce(input, input.type === "checkbox" ? input.checked : input.value));
  }
  return patch;
}

/** Call `handler(patch, event)` on any change (debounced by the caller). */
export function onFormChange(root, handler) {
  root.addEventListener("input", (event) => {
    const input = event.target.closest?.("[data-setting]");
    if (!input) return;
    const output = input.dataset.output ? root.querySelector(input.dataset.output) : null;
    if (output) output.textContent = input.type === "range" ? Number(input.value).toFixed(2) : input.value;
    handler(readForm(root), event);
  });
  root.addEventListener("change", (event) => {
    const input = event.target.closest?.("[data-setting]");
    if (!input) return;
    handler(readForm(root), event);
  });
}
