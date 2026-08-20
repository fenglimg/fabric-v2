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
    if (!btn) return;
    // Once the navbar upgrade has run, the button holds an <svg>; before that it
    // is still the template's `☀` character. Writing textContent in the first
    // case would delete the icon, so which branch applies is decided by what is
    // actually in the button, not by when we think the upgrade ran.
    if (btn.classList.contains("fx-icon-btn")) paintThemeBtn(theme);
    else btn.textContent = theme === "dark" ? "☾" : "☀";
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

  // --- icons ---------------------------------------------------------------
  // An inline SVG set. Zero build, zero dependency, zero network: the whole
  // point of the console is that it runs from a file on disk with no toolchain.
  //
  // Geometry follows lucide's (MIT) 24-grid conventions, hand-written as paths
  // rather than pulled from the package — adding an npm dependency to render
  // sixteen glyphs would trade the constraint this console is built around for
  // convenience we do not need.
  //
  // Colour is NOT set here: `stroke="currentColor"` means an icon is whatever
  // colour its container resolved to, including on hover and in dark mode, with
  // no second rule to keep in sync. Size and shrink-resistance come from the
  // `.fx-ico` class in shell.css. Between them, nobody ever decides how an icon
  // should look at a call site — which is exactly why the reference product's
  // icons are consistent and ours (all zero of them) were not.
  var ICON_PATHS = {
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    graph:
      '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M10.5 7 6.6 16.7M13.5 7l3.9 9.7M7.5 19h9"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    sliders:
      '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    plug: '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v5"/>',
    layers: '<path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
    database:
      '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    tag: '<path d="M12 2H2v10l10 10 10-10z"/><circle cx="7" cy="7" r="1.5"/>',
    check: '<path d="m5 13 4 4L19 7"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.4 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.1z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5l-9.9 9.9a2.1 2.1 0 0 1-3-3l9.9-9.9z"/><path d="M14.7 6.3 18.5 2.5"/>',
    terminal: '<path d="m4 17 6-5-6-5M12 19h8"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/><path d="M10 11v5M14 11v5"/>',
    loader: '<path d="M12 3v4M12 17v4M5.6 5.6l2.9 2.9M15.5 15.5l2.9 2.9M3 12h4M17 12h4M5.6 18.4l2.9-2.9M15.5 8.5l2.9-2.9"/>',
  };

  var FabricIcon = {
    has: function (name) {
      return Object.prototype.hasOwnProperty.call(ICON_PATHS, name);
    },
    /** Inline `<svg>` markup for `name`, or `""` when the name is unknown. */
    svg: function (name, cls) {
      var d = ICON_PATHS[name];
      if (!d) return "";
      return (
        '<svg class="fx-ico' +
        (cls ? " " + cls : "") +
        '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        d +
        "</svg>"
      );
    },
  };

  window.FabricIcon = FabricIcon;

  // --- navbar upgrade --------------------------------------------------------
  // The six lines of navbar markup are still copied into each page. What changed
  // this round is that they are no longer the FINISHED article — icons, the
  // active underline's aria pairing, and the action group are applied here.
  //
  // This reverses the reasoning that used to sit in shell.css ("the structure is
  // copied because it does not change"). It changed. And one of the five copies
  // is inside lumen.html, which is the zero-regression protected file — so a
  // structure with five producers, one of them read-only, cannot be evolved by
  // editing the producers. It gets one upgrader instead.
  //
  // Everything here is additive and idempotent: a page that never adopts it
  // still renders, and running it twice produces the same DOM.
  var NAV_ICONS = { "/": "book", "/graph": "graph", "/status": "activity", "/config": "sliders", "/integrations": "plug" };

  document.addEventListener("DOMContentLoaded", function () {
    var here = location.pathname === "/index.html" ? "/" : location.pathname;
    var links = document.querySelectorAll(".navbar a.seg[href]");
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var href = link.getAttribute("href").split("?")[0];
      if (href === here) {
        link.className = "seg active";
        // aria-current is what tells a screen reader which page this is. The
        // underline says it to everyone else; without this it says it to nobody
        // who is not looking at the screen.
        link.setAttribute("aria-current", "page");
      }
      var icon = FabricIcon.svg(NAV_ICONS[href]);
      if (icon && !link.querySelector("svg")) {
        link.innerHTML = icon + "<span>" + link.textContent.trim() + "</span>";
      }
      // Carry the scope across pages. Without this, clicking 知识 → 状态 would
      // silently drop you back to the launch directory, which is exactly the
      // "which project am I looking at" confusion the scope model removes.
      link.setAttribute("href", FabricScope.href(href));
    }

    // The theme button is a glyph in the templates (`☀`). Swap it for a real
    // icon and give it the icon-button box, so it stops being the one control
    // in the bar that is a text character pretending to be a button.
    var themeBtn = document.getElementById("shellThemeBtn");
    if (themeBtn && !themeBtn.querySelector("svg")) {
      themeBtn.className = "fx-icon-btn";
      themeBtn.setAttribute("aria-label", "切换主题");
      paintThemeBtn(document.documentElement.getAttribute("data-theme"));
    }

    var title = document.querySelector(".navbar .nav-title");
    if (title && !title.querySelector("svg")) {
      title.innerHTML = FabricIcon.svg("layers") + "<span>" + title.textContent.trim() + "</span>";
    }
  });

  function paintThemeBtn(theme) {
    var btn = document.getElementById("shellThemeBtn");
    if (!btn || !btn.classList.contains("fx-icon-btn")) return;
    btn.innerHTML = FabricIcon.svg(theme === "dark" ? "moon" : "sun");
  }

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

  // --- config field control ----------------------------------------------
  // ONE renderer for "a config key you can change", used by the settings page
  // and by the integrations page's behaviour rows.
  //
  // The alternative was for the second page to render its own control against
  // the same `/api/config/set`. It would have worked on the day it was written,
  // and then the two would have drifted the first time the field payload gained
  // a case — a widget type, an env lock, a new reason a key is not editable.
  // The server already refuses to have two producers of a field's value
  // (KT-MOD-0004); the browser should not have two producers of its control.
  //
  // Write POLICY stays with the page: `bind` takes the page's own `post`, so
  // each page keeps its toast copy, its reload strategy, and its error
  // branches. What is shared is the markup and the DOM wiring, which is exactly
  // the part that has no page-specific content.
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;";
    });
  }

  var FabricField = {
    /**
     * The provenance chip: which layer decided this value, and whether that
     * layer is the one you are looking at.
     *
     * Three states, because there are three. A row used to be able to say only
     * "set here" or nothing at all, and the nothing covered two different
     * situations — no layer holds this key, versus a layer above holds it — so
     * "I see `silent` on this project, did I set that?" had no answer on the
     * page. `inherited` splits them; `sourceLabel` names the layer in the
     * user's own language.
     *
     * @param f       one FieldView
     * @param strings the page's chrome strings; needs `modified`,
     *                `inherited-from`
     */
    sourceTag: function (f, strings) {
      var title = f.modified
        ? strings.modified
        : f.inherited
          ? String(strings["inherited-from"]).replace("{source}", f.sourceLabel)
          : "";
      var cls = f.source === "env" ? " env" : f.modified ? " set" : "";
      return (
        '<span class="tag' +
        cls +
        '"' +
        (title ? ' title="' + esc(title) + '"' : "") +
        ">" +
        esc(f.sourceLabel) +
        "</span>"
      );
    },

    /**
     * @param f       one FieldView from /api/config or /api/integrations
     * @param target  the write target, serialized into the button's dataset
     * @param strings the page's chrome strings; needs `save`, `reset`,
     *                `env-locked`, and `multi-hint` for set-valued fields
     */
    control: function (f, target, strings) {
      if (!f.editable) {
        // An environment variable is deciding this value. Rendering a disabled
        // input would invite people to keep trying it; the reason belongs in
        // the place the control would have been.
        return (
          '<span class="note warn">' +
          esc(String(strings["env-locked"]).replace("{name}", f.envVar)) +
          "</span>"
        );
      }
      var id = "c" + Math.random().toString(36).slice(2, 9);
      var t = esc(JSON.stringify(target));
      // "Remove the setting made here" appears only where THIS layer actually
      // holds a value. Offering it on an inherited row gives you a button that
      // does nothing.
      //
      // It is NOT inside `.fx-actions`. The two write actions look alike and sit
      // side by side, but they become available for opposite reasons:
      //
      //   save    — once the control's value differs from what it loaded with
      //   remove  — whenever this layer holds a value, REGARDLESS of the control
      //
      // They shared the dirty-gated wrapper until 08-20, which made the remove
      // button unreachable in practice: withdrawing a setting and letting the
      // layer below decide again is precisely the gesture that does not touch
      // the value, so the control never became dirty and the button never
      // appeared. Every row on the integrations page was in that state.
      var revert = f.modified
        ? '<button class="fx-btn ghost sm fx-revert" data-reset="' +
          esc(f.key) +
          '" data-target="' +
          t +
          '">' +
          esc(strings.reset) +
          "</button>"
        : "";
      var save =
        '<button class="fx-btn sm" data-ctl="' +
        id +
        '" data-key="' +
        esc(f.key) +
        '" data-target="' +
        t +
        '">' +
        esc(strings.save) +
        "</button>";
      // Save exists in the DOM at all times but is only shown once the control
      // is dirty. Sixteen permanently-lit Save buttons on a page where nothing
      // has been edited is sixteen invitations to press something that would do
      // nothing — and it hides the one row you actually changed.
      //
      // Hidden rather than re-rendered on change: re-rendering the row would
      // drop focus and caret position mid-typing, which is a worse bug than the
      // one being fixed.
      var actions = '<div class="fx-row">' + revert + '<div class="fx-actions">' + save + "</div></div>";

      if (f.widget === "multiselect") {
        // The checkboxes only update the hidden input; saving still reads
        // `#id.value`. One code path for all three write actions — a second
        // "how does this kind of control produce a value" branch is a second
        // thing to forget to update. The comma-joined string is exactly what
        // the server's validate accepts, so the transport never has to know
        // which keys are sets.
        var on = {};
        String(f.effective || "")
          .split(",")
          .forEach(function (v) {
            if (v) on[v] = true;
          });
        var boxes = (f.enumValues || [])
          .map(function (v) {
            return (
              '<label><input type="checkbox" data-set="' +
              id +
              '" value="' +
              esc(v) +
              '"' +
              (on[v] ? " checked" : "") +
              " />" +
              esc(v) +
              "</label>"
            );
          })
          .join("");
        return (
          '<div class="fctl multi" data-dirty="false" data-initial="' +
          esc(f.effective) +
          '"><div class="chk">' +
          boxes +
          '</div><input type="hidden" data-value-el id="' +
          id +
          '" value="' +
          esc(f.effective) +
          '" />' +
          actions +
          // A box of checkboxes with one Save button reads as one-way: there is
          // no visible way to undo it, and "untick everything" and "withdraw the
          // setting" look like the same gesture while meaning opposite things —
          // an explicit empty list versus letting the layer below decide again.
          // The reset button says the second, but only appears once this layer
          // holds a value, so on a fresh field the distinction is invisible.
          '<div class="note">' +
          esc(strings["multi-hint"]) +
          "</div>" +
          "</div>"
        );
      }

      var input;
      if (f.widget === "select") {
        input =
          '<select data-value-el id="' +
          id +
          '">' +
          (f.enumValues || [])
            .map(function (v) {
              return (
                '<option value="' +
                esc(v) +
                '"' +
                (v === f.effective ? " selected" : "") +
                ">" +
                esc(v) +
                "</option>"
              );
            })
            .join("") +
          "</select>";
      } else {
        input = '<input type="text" data-value-el id="' + id + '" value="' + esc(f.effective) + '" />';
      }
      return (
        '<div class="fctl" data-dirty="false" data-initial="' +
        esc(f.effective) +
        '">' +
        input +
        actions +
        "</div>"
      );
    },

    /**
     * Wire every control rendered since the last render.
     *
     * @param opts.post  post(url, body, btn, okMessageFn) — the page's own
     * @param opts.saved  (target) => string   toast copy for a save
     * @param opts.reset  (target) => string   toast copy for a reset
     */
    bind: function (root, opts) {
      var scope = root || document;

      // A control is "dirty" when its current value differs from the one it
      // loaded with — not when it has been touched. Typing a character and
      // deleting it again leaves you where you started, and the row should say
      // so rather than keep offering to save a no-op.
      //
      // The value is read from the element MARKED as carrying it, never from
      // "the first input or select in the subtree". A set-valued control is a
      // row of checkboxes followed by the hidden input that actually holds the
      // comma-joined value, so document order hands you a checkbox — and the
      // previous version special-cased that by treating a checkbox as the empty
      // string. The result was a control whose measured value was the constant
      // "" no matter what you ticked: on an unset field it matched the empty
      // initial and the row was permanently clean (Save never appeared, ticking
      // boxes did nothing), and on a field this layer had set it never matched
      // and the row was permanently dirty. Same bug, opposite symptom.
      //
      // An explicit marker also keeps the three widgets on one code path, which
      // is the property that made the bug possible to miss: text and select
      // worked by accident of document order.
      function refresh(ctl) {
        if (!ctl) return;
        var el = ctl.querySelector("[data-value-el]");
        if (!el) return;
        ctl.setAttribute(
          "data-dirty",
          String(el.value) === ctl.getAttribute("data-initial") ? "false" : "true",
        );
      }

      scope.querySelectorAll(".fctl").forEach(function (ctl) {
        refresh(ctl);
        ["input", "change"].forEach(function (ev) {
          ctl.addEventListener(ev, function () {
            refresh(ctl);
          });
        });
      });

      scope.querySelectorAll("[data-set]").forEach(function (box) {
        box.addEventListener("change", function () {
          var target = box.getAttribute("data-set");
          var picked = [];
          scope.querySelectorAll('[data-set="' + target + '"]').forEach(function (b) {
            if (b.checked) picked.push(b.value);
          });
          var hidden = document.getElementById(target);
          if (hidden) hidden.value = picked.join(",");
          // The hidden input carries the value, so changing a checkbox does not
          // by itself fire an event the dirty check can see. Refresh explicitly.
          refresh(box.closest(".fctl"));
        });
      });
      scope.querySelectorAll("[data-ctl]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var ctl = document.getElementById(btn.getAttribute("data-ctl"));
          if (!ctl) return;
          opts.post(
            "/api/config/set",
            {
              key: btn.getAttribute("data-key"),
              value: ctl.value,
              action: "set",
              target: JSON.parse(btn.getAttribute("data-target")),
            },
            btn,
            function (b) {
              return opts.saved(b.target);
            },
          );
        });
      });
      scope.querySelectorAll("[data-reset]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          opts.post(
            "/api/config/set",
            {
              key: btn.getAttribute("data-reset"),
              action: "reset",
              target: JSON.parse(btn.getAttribute("data-target")),
            },
            btn,
            function (b) {
              return opts.reset(b.target);
            },
          );
        });
      });
    },

    /** The shared transient message. Expects `<div class="toast" id="toast">`. */
    toast: function (msg, bad) {
      var el = document.getElementById("toast");
      if (!el) return;
      el.textContent = msg;
      el.className = "toast show" + (bad ? " bad" : "");
      setTimeout(function () {
        el.className = "toast" + (bad ? " bad" : "");
      }, 3600);
    },
  };

  window.FabricField = FabricField;

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
        // 一条理由一行,因为三种「打不开」的解法不一样。以前合成一个总数配一句
        // 「在其仓库跑 fabric install」,对另外两种都是错的建议 —— 目录还在、只是
        // 没绑 store 的项目,重装并不会给它 id。
        var blocked = d.blockedByReason || {};
        var advice = {
          "no-path": "只知道 id、不知道目录 —— 用状态页的「扫描本机」找回",
          stale: "登记的目录已经不在了 —— 移回原处,或在新位置跑 fabric install",
          "no-id": "还没绑定 store,所以没有 id —— 在其目录跑 fabric store bind",
        };
        ["no-path", "stale", "no-id"].forEach(function (reason) {
          if (!blocked[reason]) return;
          html +=
            '<option value="" disabled>另有 ' +
            blocked[reason] +
            " 个" +
            advice[reason] +
            "</option>";
        });
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
