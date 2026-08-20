/**
 * The shared chrome must not read a token name that a page can redefine.
 *
 * `shell.css` is `<link>`ed by every console page, and a page's own inline
 * `<style>` loads AFTER it — so a custom property the page declares in `:root`
 * wins inside the shared chrome too. `--accent` was declared in both places
 * with opposite meanings (pale hover grey here, brand blue in lumen), which
 * painted `.seg:hover` solid blue on the knowledge page only: an unselected nav
 * tab heavier than the selected one.
 *
 * That class of bug is invisible at the selector level — no page stylesheet
 * mentions `.seg` at all — so the guard has to be stated at the token level.
 * This asserts the MECHANISM (the two name-sets are disjoint), not the current
 * values; re-declaring `--accent: #2563eb` in a page is fine as long as the
 * chrome has stopped reading that name.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const TEMPLATES = join(__dirname, "..", "templates");
const SHELL_CSS = join(TEMPLATES, "console", "shell.css");

/** Every page that loads `shell.css`, i.e. every page the chrome renders on. */
const PAGES = [
  join(TEMPLATES, "console", "config.html"),
  join(TEMPLATES, "console", "graph.html"),
  join(TEMPLATES, "console", "integrations.html"),
  join(TEMPLATES, "console", "status.html"),
  join(TEMPLATES, "preview", "lumen.html"),
];

/**
 * Comments out. Both files below explain their tokens in prose that quotes the
 * very names being discussed, and a name inside a comment is not a read or a
 * declaration.
 */
function code(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Custom properties this CSS READS. */
function tokensRead(css: string): Set<string> {
  return new Set(Array.from(code(css).matchAll(/var\(\s*(--[a-z0-9-]+)/g), (m) => m[1]!));
}

/**
 * Custom properties this CSS DECLARES.
 *
 * `var(--x)` reads are stripped first so a read is never mistaken for a
 * declaration — `--surface-hover: var(--fx-accent)` declares one name and reads
 * another.
 */
function tokensDeclared(css: string): Set<string> {
  const withoutReads = code(css).replace(/var\(\s*--[a-z0-9-]+/g, "var(");
  return new Set(Array.from(withoutReads.matchAll(/(--[a-z0-9-]+)\s*:/g), (m) => m[1]!));
}

/** The contents of every inline `<style>` element in an HTML template. */
function inlineStyles(html: string): string {
  return Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi), (m) => m[1]!).join("\n");
}

describe("shared chrome tokens are not redefinable by any page", () => {
  it("no token the chrome reads is declared by a page's inline style", () => {
    const chromeReads = tokensRead(readFileSync(SHELL_CSS, "utf8"));

    const collisions: string[] = [];
    for (const page of PAGES) {
      const declared = tokensDeclared(inlineStyles(readFileSync(page, "utf8")));
      for (const token of declared) {
        if (chromeReads.has(token)) collisions.push(`${page.split("/").pop()}: ${token}`);
      }
    }

    expect(collisions).toEqual([]);
  });

  it("the pages really do redeclare tokens, so the guard above is not vacuous", () => {
    // If lumen ever stopped declaring its own palette, the disjointness above
    // would go green for the wrong reason and stop protecting anything.
    const lumen = tokensDeclared(inlineStyles(readFileSync(PAGES[4]!, "utf8")));
    expect(lumen.size).toBeGreaterThan(20);
    expect(lumen.has("--accent")).toBe(true);
  });

  it("blue is spent only on selection (and, via --ring, on focus)", () => {
    // `--primary` had grown four jobs — focus, selected, set-at-this-layer, and
    // primary action — and the user's report was the symptom: with everything
    // shouting, the solid blue blocks read as noise rather than as pointing at
    // anything. It now means SELECTED, and `--ring` (which is the same value)
    // means FOCUSED.
    //
    // This is a PIN, not a mechanism: "blue means selected" is a judgement no
    // parser can make. Its job is to make spending blue somewhere new a
    // deliberate act — an edit here, with a reason — instead of a default that
    // erodes the meaning again one rule at a time. If you are adding a genuine
    // selected state, add its selector below.
    const css = code(readFileSync(SHELL_CSS, "utf8"));
    const selectors: string[] = [];
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/var\(\s*--primary\s*\)/.test(match[2]!)) selectors.push(match[1]!.trim());
    }
    expect(selectors.sort()).toEqual([
      ".chk input[type=\"checkbox\"]", // a ticked box IS the selection
      ".fx-tab[aria-selected=\"true\"]",
      ".seg.active",
      ".seg.active::after",
    ]);
  });

  it("every fx- token the chrome reads is declared with a literal, not an alias", () => {
    // `--fx-accent: var(--accent)` would look like a fix and restore the bug one
    // hop later: the alias resolves against the page's `:root`, so lumen's blue
    // would flow straight back into `.seg:hover`.
    const css = code(readFileSync(SHELL_CSS, "utf8"));
    const fxDecls = Array.from(css.matchAll(/(--fx-[a-z0-9-]+)\s*:([^;]*);/g));
    expect(fxDecls.length).toBeGreaterThan(0);
    for (const [, name, value] of fxDecls) {
      expect(`${name} = ${value!.trim()}`).not.toMatch(/var\(/);
    }
  });
});
