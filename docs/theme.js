// Dark by default; a visitor's choice is remembered per browser.
// Loaded synchronously in <head> so the stored theme applies before first paint.
(function () {
  var KEY = "deslopify-theme";
  var root = document.documentElement;
  function apply(theme) {
    if (theme === "light") root.dataset.theme = "light";
    else delete root.dataset.theme;
    var button = document.querySelector(".theme-toggle");
    if (button) button.setAttribute("aria-label", theme === "light" ? "Switch to dark mode" : "Switch to light mode");
  }
  var stored = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch (_) {}
  apply(stored);
  document.addEventListener("DOMContentLoaded", function () {
    apply(stored);
    var button = document.querySelector(".theme-toggle");
    if (!button) return;
    button.addEventListener("click", function () {
      stored = root.dataset.theme === "light" ? "dark" : "light";
      apply(stored);
      try {
        localStorage.setItem(KEY, stored);
      } catch (_) {}
    });
  });
})();
