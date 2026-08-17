/* ---------------------------------------------------------------------------
 * Fabric console — shared shell script. Served at GET /assets/shell.js.
 *
 * Only cross-page chrome behaviour lives here. Page logic stays in its page.
 *
 * The theme key `pcf-theme` and the `data-theme` attribute are lumen.html's,
 * reused verbatim: before this, lumen honoured an explicit toggle stored in
 * localStorage while /graph followed prefers-color-scheme, so switching to dark
 * on the list page and clicking through to the graph snapped you back to light.
 * Two pages that disagree about the theme do not read as one product.
 *
 * No build step, no modules, no dependencies — a plain <script src> that runs
 * everywhere the console does (R3).
 * ------------------------------------------------------------------------- */
(function () {
  var KEY = "pcf-theme";

  function systemPrefersDark() {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch (e) {
      return false;
    }
  }

  function stored() {
    try {
      return localStorage.getItem(KEY);
    } catch (e) {
      return null;
    }
  }

  // An explicit choice wins; with no choice on record, follow the system. lumen
  // hard-defaults to light instead — it owns the toggle button, so leaving its
  // behaviour alone is part of "read-only zero regression". Pages that adopt
  // this script get the system default.
  function resolve() {
    var s = stored();
    return s === "dark" || s === "light" ? s : systemPrefersDark() ? "dark" : "light";
  }

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    var btn = document.getElementById("shellThemeBtn");
    if (btn) btn.textContent = theme === "dark" ? "☾" : "☀";
  }

  apply(resolve());

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("shellThemeBtn");
    if (!btn) return;
    apply(resolve());
    btn.addEventListener("click", function () {
      var next =
        document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(KEY, next);
      } catch (e) {
        /* private mode — the toggle still works for this page load */
      }
      apply(next);
    });
  });

  // Mark the nav entry for the current page. Doing it here rather than baking
  // `class="seg active"` into each template keeps the six nav lines identical
  // across pages, so copying them stays safe.
  document.addEventListener("DOMContentLoaded", function () {
    var here = location.pathname === "/index.html" ? "/" : location.pathname;
    var links = document.querySelectorAll(".navbar a.seg[href]");
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute("href").split("?")[0];
      if (href === here) links[i].className = "seg active";
    }
  });
})();
