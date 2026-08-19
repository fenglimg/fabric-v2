#!/usr/bin/env node
/**
 * Console UI metrics probe — the oracle for the acceptance criteria in
 * `.trellis/tasks/08-19-console-interface-quality/prd.md`.
 *
 * Two halves, split by what can actually be decided without a renderer:
 *
 *   STATIC   — checked here, by reading the template sources. Literal colours,
 *              bare tag selectors, the `fx-` prefix rule, hardcoded font sizes.
 *              These are real assertions; a non-zero exit means an AC regressed.
 *
 *   RUNTIME  — printed, not executed. Type tiers, colour counts, row heights and
 *              document height need computed styles, and this repo has no headless
 *              browser. Paste the printed expression into the console of each page
 *              (`fabric preview`, then /, /graph, /status, /config, /integrations).
 *
 * The point of the file is that the metric definitions live in ONE versioned
 * place. Re-deriving "how did we count colours last time" by hand is how a
 * before/after comparison quietly stops comparing the same thing.
 *
 *   node packages/cli/__tests__/manual/ui-metrics-probe.mjs          # run static, print runtime
 *   node packages/cli/__tests__/manual/ui-metrics-probe.mjs --probe  # print runtime only
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONSOLE_DIR = join(HERE, "..", "..", "templates", "console");
/** `lumen.html` predates the console directory and still lives beside it. */
const PREVIEW_DIR = join(HERE, "..", "..", "templates", "preview");

/** Pages the ACs cover. `lumen.html` and `graph.html` are protected, not rebuilt. */
const REBUILT = ["status.html", "config.html", "integrations.html"];
const PROTECTED = [join(PREVIEW_DIR, "lumen.html"), join(CONSOLE_DIR, "graph.html")];

const failures = [];
const notes = [];

function fail(ac, file, msg) {
  failures.push(`${ac}  ${file}: ${msg}`);
}

function read(name) {
  return readFileSync(join(CONSOLE_DIR, name), "utf8");
}

/** The `<style>` body of a page template, or "" when it has none. */
function styleBlock(src) {
  const m = src.match(/<style>([\s\S]*?)<\/style>/);
  return m ? m[1] : "";
}

// ---------------------------------------------------------------------------
// AC16 — no literal colours outside `:root` / `[data-theme]`.
//
// The failure this catches is not ugliness. A hardcoded `#b45309` needs a
// matching `[data-theme="dark"]` override or it stays unreadable in dark mode,
// and every such pair is a place the two themes can drift apart. Tokens invert
// once, centrally.
// ---------------------------------------------------------------------------
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGBA = /\brgba?\(\s*\d/g;

function checkLiteralColours() {
  const shell = read("shell.css");
  // Only the declaration blocks that DEFINE tokens may hold literals. Strip them
  // one at a time — joining them into a single haystack and calling replace()
  // once matches nothing, and the check then reports every token in the file.
  let outside = shell;
  for (const m of shell.matchAll(/(?::root|\[data-theme="[^"]+"\])\s*\{[\s\S]*?\n\}/g)) {
    outside = outside.replace(m[0], "");
  }
  for (const re of [HEX, RGBA]) {
    for (const hit of outside.matchAll(re)) {
      fail("AC16", "shell.css", `literal colour ${hit[0]} outside :root`);
    }
  }
  for (const page of REBUILT) {
    const css = styleBlock(read(page));
    for (const re of [HEX, RGBA]) {
      for (const hit of css.matchAll(re)) {
        fail("AC16", page, `literal colour ${hit[0]} in page style block`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// design C1 — shell.css reaches lumen.html, so it may not carry bare tag
// selectors, and every class it introduces must be `fx-` prefixed or already
// part of the pre-existing shared vocabulary.
// ---------------------------------------------------------------------------
const SHARED_LEGACY = new Set([
  "navbar", "nav-title", "seg", "spacer", "scope-select", "scope-wrap",
  "frow", "fmain", "fexp", "fctl", "flabel", "fkey", "fdesc", "mod",
  "chk", "note", "warn", "toast", "bad", "multi", "active", "on", "off",
]);

function checkSelectorHygiene() {
  const shell = read("shell.css");
  const body = shell.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of body.matchAll(/(^|\n)\s*([^@{}\n][^{}\n]*)\{/g)) {
    const sel = m[2].trim();
    if (!sel || sel.startsWith("from") || sel.startsWith("to") || /^\d+%/.test(sel)) continue;
    for (const part of sel.split(",")) {
      const unit = part.trim();
      if (!unit) continue;
      // A bare tag selector is one whose every compound starts with a letter
      // and never carries a class, id, or attribute qualifier.
      const compounds = unit.split(/[\s>+~]+/).filter(Boolean);
      const bare = compounds.filter((c) => /^[a-z][a-z0-9]*$/.test(c) && c !== "html" && c !== "body");
      if (bare.length === compounds.length && bare.length > 0) {
        fail("C1", "shell.css", `bare tag selector "${unit}"`);
      }
      // What matters is whether the SELECTOR can reach lumen's markup, not
      // whether every token in it carries the prefix. `.fx-btn.ghost` and
      // `.navbar .extra` are both anchored by a namespaced ancestor, so the
      // modifier名 can be short. Only a selector with no anchor anywhere is a
      // real collision risk.
      const names = [...unit.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((c) => c[1]);
      if (names.length === 0) continue;
      const anchored = names.some((n) => n.startsWith("fx-") || SHARED_LEGACY.has(n));
      if (!anchored) {
        fail("C1", "shell.css", `unanchored selector "${unit}" — needs an fx- (or known shared) class`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// AC10 — no page repeats a heading string. Seven `<h3>调节项</h3>` in one
// document is seven headings that cannot be told apart in a document outline,
// a find-in-page, or a screen reader's heading list.
// ---------------------------------------------------------------------------
function checkDuplicateHeadingLiterals() {
  for (const page of REBUILT) {
    const src = read(page);
    // Headings built from a single constant string literal are the ones that
    // can be judged statically; template-derived headings are runtime work.
    const counts = new Map();
    for (const m of src.matchAll(/<h([23])[^>]*>'\s*\+\s*esc\(S\('([^']+)'\)\)/g)) {
      counts.set(m[2], (counts.get(m[2]) ?? 0) + 1);
    }
    for (const [key, n] of counts) {
      if (n > 1) fail("AC10", page, `heading string "${key}" emitted from ${n} sites`);
    }
  }
}

// ---------------------------------------------------------------------------
// AC1 — the type scale is a scale, not a pile. Rebuilt pages must not hardcode
// px font sizes; they read `--fs-N`.
// ---------------------------------------------------------------------------
function checkTypeScaleUse() {
  for (const page of REBUILT) {
    const css = styleBlock(read(page));
    for (const m of css.matchAll(/font-size:\s*(\d+)px/g)) {
      fail("AC1", page, `hardcoded font-size ${m[1]}px — use var(--fs-N)`);
    }
  }
}

// ---------------------------------------------------------------------------
// AC20 — the protected pages stay untouched by this task.
// ---------------------------------------------------------------------------
function reportProtected() {
  for (const path of PROTECTED) {
    const src = readFileSync(path, "utf8");
    const name = path.split("/").pop();
    notes.push(`${name}: ${src.split("\n").length} lines, ${(src.match(/\bclass="/g) ?? []).length} class attrs`);
  }
}

// ---------------------------------------------------------------------------
// RUNTIME probe — paste into the page console.
// ---------------------------------------------------------------------------
const RUNTIME_PROBE = `(() => {
  const main = document.getElementById('main') || document.body;
  const vis = el => el.offsetParent !== null || el === document.body;
  const texty = [...main.querySelectorAll('*')].filter(
    el => vis(el) && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
  const tally = (arr, f) => arr.reduce((m, el) => (m[f(el)] = (m[f(el)] || 0) + 1, m), {});
  const cs = el => getComputedStyle(el);
  const sizes = tally(texty, el => cs(el).fontSize);
  const rows = [...main.querySelectorAll('.frow')].map(el => Math.round(el.getBoundingClientRect().height));
  const shadowed = [...main.querySelectorAll('*')].filter(
    el => vis(el) && cs(el).boxShadow !== 'none' && !el.closest('.toast'));
  const heads = [...main.querySelectorAll('h1,h2,h3')].map(el => el.textContent.trim());
  return {
    docH: document.documentElement.scrollHeight,          // AC7
    fontSizes: sizes,                                      // AC1
    tiersAbove14: Object.keys(sizes).filter(k => parseFloat(k) > 14),  // AC3
    colors: tally(texty, el => cs(el).color),              // AC4
    weights: tally(texty, el => cs(el).fontWeight),        // AC1
    shadowedContentEls: shadowed.length,                   // AC5
    icons: main.querySelectorAll('svg').length,            // AC6
    rowMax: rows.length ? Math.max(...rows) : 0,           // AC8
    rowCount: rows.length,
    visibleSaveButtons: [...main.querySelectorAll('.fx-actions')].filter(vis).length, // AC9
    duplicateHeadings: heads.filter((h, i) => heads.indexOf(h) !== i),  // AC10
    hScroll: document.documentElement.scrollWidth > window.innerWidth,  // AC18
  };
})()`;

// ---------------------------------------------------------------------------

const probeOnly = process.argv.includes("--probe");

if (!probeOnly) {
  const present = new Set(readdirSync(CONSOLE_DIR));
  for (const f of [...REBUILT, "shell.css"]) {
    if (!present.has(f)) {
      console.error(`missing template: ${f}`);
      process.exit(2);
    }
  }
  checkLiteralColours();
  checkSelectorHygiene();
  checkDuplicateHeadingLiterals();
  checkTypeScaleUse();
  reportProtected();

  console.log("── static checks ──");
  if (failures.length === 0) console.log("all clear");
  else for (const f of failures) console.log("FAIL " + f);
  console.log("");
  for (const n of notes) console.log("note " + n);
  console.log("");
}

console.log("── runtime probe (paste into each page's console) ──");
console.log(RUNTIME_PROBE);

if (!probeOnly && failures.length > 0) process.exit(1);
