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

  // A page may declare that it owns the theme (`<html data-theme-owner="page">`).
  // lumen.html does: it hard-defaults to light and sets `data-theme` from its own
  // script at the end of body. Without this opt-out, shell.js would apply the
  // system preference first and lumen would overwrite it a moment later — a
  // visible dark→light flash on every load for a system-dark user.
  var pageOwnsTheme =
    document.documentElement.getAttribute("data-theme-owner") === "page";

  if (!pageOwnsTheme) apply(resolve());

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("shellThemeBtn");
    if (!btn || pageOwnsTheme) return;
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
      // Carry the scope across pages. Without this, clicking 知识 → 状态 would
      // silently drop you back to the launch directory, which is exactly the
      // "which project am I looking at" confusion the scope model removes.
      links[i].setAttribute("href", FabricScope.href(href));
    }
  });

  // --- scope -------------------------------------------------------------
  // The selected scope is a URL parameter (shareable, refreshable, back-button
  // correct) with localStorage as the DEFAULT only. Resolution is deliberately
  // SYNCHRONOUS and server-free: pages fetch their data immediately on load, so
  // a scope that required a round-trip to know would make every page either
  // block or briefly render the wrong project.
  //
  // `null` means "the server's default" and is sent as no parameter at all —
  // which is what every request meant before scopes existed.
  var SCOPE_KEY = "pcf-scope";

  function readScope() {
    try {
      var fromUrl = new URLSearchParams(location.search).get("scope");
      if (fromUrl) return fromUrl;
    } catch (e) {
      /* pre-URLSearchParams browser — fall through to the stored default */
    }
    try {
      return localStorage.getItem(SCOPE_KEY);
    } catch (e) {
      return null;
    }
  }

  var current = readScope();

  var FabricScope = {
    /** The selected scope id, or null for the server default. */
    current: function () {
      return current;
    },
    /** `"?scope=x"` / `"&scope=x"`, or `""` when no scope is selected. */
    param: function (leading) {
      if (!current) return "";
      return (leading || "?") + "scope=" + encodeURIComponent(current);
    },
    /** A same-origin URL with the scope preserved. */
    href: function (path) {
      var base = path.split("?")[0];
      var rest = path.indexOf("?") >= 0 ? path.split("?")[1] : "";
      var q = [];
      if (rest) q.push(rest);
      if (current) q.push("scope=" + encodeURIComponent(current));
      return q.length ? base + "?" + q.join("&") : base;
    },
    select: function (id) {
      try {
        if (id) localStorage.setItem(SCOPE_KEY, id);
        else localStorage.removeItem(SCOPE_KEY);
      } catch (e) {
        /* private mode — the URL still carries it for this navigation */
      }
      current = id;
      location.href = FabricScope.href(location.pathname);
    },
    /**
     * Turn a failed scoped response into a reason and a next step.
     *
     * Returned as plain strings rather than markup so each page renders it in
     * its own empty-state shape. Every failure here is permanent until the user
     * acts — there is no reverse map from a project_id to a directory — so a
     * "retry" affordance would be a lie.
     */
    describeError: function (status, payload) {
      var reason = (payload && payload.reason) || "";
      if (reason === "stale") {
        return {
          title: "这个项目的目录已不在原处",
          body:
            "它注册时的路径现在不存在了 —— 多半是被移动或删除。在它的新位置跑一次 <code>fabric install</code> 重新登记，切换器里就会指向新路径。",
        };
      }
      if (reason === "no-path") {
        return {
          title: "这个项目从未登记过目录",
          body:
            "本机只存有它的配置，没有存过它在磁盘上的位置，而 project_id 无法反推目录。在那个仓库里跑一次 <code>fabric install</code> 之后才能切换过去。",
        };
      }
      if (reason === "unknown") {
        return {
          title: "找不到这个项目",
          body: "地址栏里的 <code>scope</code> 不是本机已知的任何项目。回到「本机」重新选一个。",
        };
      }
      return {
        title: "读取失败",
        body:
          "HTTP " +
          status +
          "。控制台只连本机，通常是服务已停止 —— 回终端看 <code>fabric preview</code> 还在不在跑。",
      };
    },
  };

  window.FabricScope = FabricScope;

  // Render the switcher into the navbar. Injected here rather than copied into
  // four templates: unlike the nav links (frozen markup), this control has
  // state and behaviour, and four copies of it would be four things to keep in
  // sync the next time scopes gain a case.
  document.addEventListener("DOMContentLoaded", function () {
    var nav = document.querySelector(".navbar");
    if (!nav) return;
    var sel = document.createElement("select");
    sel.className = "scope-select";
    sel.id = "shellScopeSelect";
    sel.title = "切换作用域";
    sel.innerHTML = '<option value="">读取中…</option>';
    var anchor = nav.querySelector(".spacer");
    if (anchor) nav.insertBefore(sel, anchor);
    else nav.appendChild(sel);

    fetch("/api/scopes", { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        var selected = current || d.defaultScope;
        var html = "";
        for (var i = 0; i < d.options.length; i++) {
          var o = d.options[i];
          if (!o.openable) continue;
          var label = o.kind === "machine" ? "本机 · 全部项目" : o.name + (o.isCurrent ? " · 当前" : "");
          html +=
            '<option value="' +
            o.id.replace(/"/g, "&quot;") +
            '"' +
            (o.id === selected ? " selected" : "") +
            ">" +
            label.replace(/</g, "&lt;") +
            "</option>";
        }
        // Say why the list is short instead of letting the user conclude those
        // projects do not exist. A disabled option is the least intrusive place
        // for it — visible in the menu, unselectable, and it needs no layout.
        if (d.blockedCount > 0) {
          html +=
            '<option value="" disabled>另有 ' +
            d.blockedCount +
            " 个项目未登记目录 —— 在其仓库跑 fabric install</option>";
        }
        sel.innerHTML = html;
        sel.addEventListener("change", function () {
          if (sel.value) FabricScope.select(sel.value);
        });
      })
      .catch(function () {
        sel.innerHTML = '<option value="">作用域读取失败</option>';
      });
  });
})();
