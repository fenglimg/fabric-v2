// @vitest-environment jsdom

/**
 * The two write actions on a config row, and the dirty check that gates one of
 * them.
 *
 * Run against a REAL DOM rather than a hand-rolled stub on purpose. Both bugs
 * these tests pin are bugs about DOM semantics — which element
 * `querySelector` returns for a multi-element subtree, and which subtree a
 * visibility rule reaches. A stub would implement those semantics from the same
 * assumptions the buggy code was written with, so it would agree with the bug
 * and pass. jsdom is an independent implementation; that independence is the
 * whole reason the dependency is worth its weight here.
 *
 * The stylesheet is loaded too, so "is Save reachable right now" is asserted as
 * a computed `display` — the property the user actually experiences — rather
 * than as the `data-dirty` attribute that merely feeds it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

const TEMPLATES = join(__dirname, "..", "templates", "console");
const SHELL_JS = readFileSync(join(TEMPLATES, "shell.js"), "utf8");
const SHELL_CSS = readFileSync(join(TEMPLATES, "shell.css"), "utf8");

const STRINGS: Record<string, string> = {
  save: "保存",
  reset: "移除此处设置",
  modified: "已在此处设置",
  "inherited-from": "继承自 {source}",
  "env-locked": "由环境变量 {name} 决定",
  "multi-hint": "全都不勾再保存，意思是明确地「一个都不关」。",
};

const TARGET = { scope: "project", projectId: "p1" };

interface FieldView {
  key: string;
  effective: string;
  widget: "text" | "select" | "multiselect";
  editable: boolean;
  modified: boolean;
  inherited?: boolean;
  source?: string;
  sourceLabel?: string;
  enumValues?: string[];
  envVar?: string;
}

function field(over: Partial<FieldView>): FieldView {
  return {
    key: "some_key",
    effective: "",
    widget: "text",
    editable: true,
    modified: false,
    sourceLabel: "内置默认",
    ...over,
  };
}

/** The page's own `FabricField`, loaded the way a browser loads it. */
interface FabricFieldApi {
  control: (f: FieldView, target: unknown, strings: Record<string, string>) => string;
  bind: (root: ParentNode, opts: Record<string, unknown>) => void;
}

function fabricField(): FabricFieldApi {
  return (window as unknown as { FabricField: FabricFieldApi }).FabricField;
}

/**
 * Render one control into the document, with the stylesheet applied and the
 * handlers bound — i.e. the state a real page is in after `load()`.
 */
function mount(f: FieldView): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = fabricField().control(f, TARGET, STRINGS);
  document.body.append(host);
  fabricField().bind(host, {
    post: () => undefined,
    saved: () => "",
    reset: () => "",
  });
  return host.querySelector<HTMLElement>(".fctl")!;
}

/**
 * Whether `el` is actually reachable inside `ctl`.
 *
 * Walks its ancestors instead of asking for its own computed `display`.
 * `getComputedStyle` reports each element's OWN display, so a button inside a
 * `display: none` wrapper still computes as `inline-flex` — checking only the
 * element itself passes while the user cannot see or press it. A mutant that
 * moved the remove button back into the dirty-gated wrapper survived the first
 * version of these tests for exactly that reason.
 */
function reachable(ctl: HTMLElement, el: Element | null): boolean {
  if (el === null) return false;
  for (let node: Element | null = el; node !== null; node = node.parentElement) {
    if (getComputedStyle(node).display === "none") return false;
    if (node === ctl) break;
  }
  return true;
}

function saveVisible(ctl: HTMLElement): boolean {
  return reachable(ctl, ctl.querySelector(".fx-actions"));
}

function tick(box: HTMLInputElement, on: boolean): void {
  box.checked = on;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
}

beforeEach(() => {
  document.head.innerHTML = `<style>${SHELL_CSS}</style>`;
  document.body.innerHTML = "";
  // The script is an IIFE that hangs its exports off `window`; evaluating it
  // twice is harmless and keeps each test independent of the previous one.
  window.eval(SHELL_JS);
});

describe("the dirty check reads the element that carries the value", () => {
  it("a set-valued control with nothing set becomes dirty when a box is ticked", () => {
    // The reported symptom. `hint_dismiss_signals` ships unset, so both the
    // control's value and its initial are the empty string. Reading the value
    // off the first checkbox instead of the hidden input made "" the answer
    // regardless of what was ticked, so this row was permanently clean and Save
    // never became reachable — ticking boxes did nothing at all.
    const ctl = mount(
      field({
        key: "hint_dismiss_signals",
        widget: "multiselect",
        effective: "",
        enumValues: ["archive", "archive_backlog", "review"],
      }),
    );

    expect(ctl.getAttribute("data-dirty")).toBe("false");
    expect(saveVisible(ctl)).toBe(false);

    const boxes = ctl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    tick(boxes[1]!, true);

    expect(ctl.querySelector<HTMLInputElement>("input[type=hidden]")!.value).toBe("archive_backlog");
    expect(ctl.getAttribute("data-dirty")).toBe("true");
    expect(saveVisible(ctl)).toBe(true);
  });

  it("un-ticking back to the loaded set makes it clean again", () => {
    // Dirty means "differs from what it loaded with", not "has been touched".
    // Without this the row keeps offering to save a no-op.
    const ctl = mount(
      field({
        key: "hint_dismiss_signals",
        widget: "multiselect",
        effective: "archive",
        modified: true,
        enumValues: ["archive", "archive_backlog"],
      }),
    );

    expect(ctl.getAttribute("data-dirty")).toBe("false");

    const boxes = ctl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    tick(boxes[1]!, true);
    expect(ctl.getAttribute("data-dirty")).toBe("true");

    tick(boxes[1]!, false);
    expect(ctl.getAttribute("data-dirty")).toBe("false");
    expect(saveVisible(ctl)).toBe(false);
  });

  it("a set-valued control this layer HAS set does not start out dirty", () => {
    // The same bug's opposite face, and the reason a one-sided test would have
    // been useless: with the value measured as a constant "", a field holding
    // "archive" never matched its own initial, so the row loaded permanently
    // dirty and offered to save a value nobody had changed.
    const ctl = mount(
      field({
        key: "hint_dismiss_signals",
        widget: "multiselect",
        effective: "archive",
        modified: true,
        enumValues: ["archive", "review"],
      }),
    );

    expect(ctl.getAttribute("data-dirty")).toBe("false");
    expect(saveVisible(ctl)).toBe(false);
  });

  it("text and select controls keep working through the same path", () => {
    // These two happened to work before, by accident of document order. They
    // are asserted here so the fix is not measured only where it was broken.
    const text = mount(field({ key: "archive_hint_hours", effective: "8" }));
    const input = text.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(text.getAttribute("data-dirty")).toBe("false");
    input.value = "12";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(text.getAttribute("data-dirty")).toBe("true");

    const sel = mount(
      field({ key: "nudge_mode", widget: "select", effective: "normal", enumValues: ["silent", "normal"] }),
    );
    const select = sel.querySelector<HTMLSelectElement>("select")!;
    expect(sel.getAttribute("data-dirty")).toBe("false");
    select.value = "silent";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(sel.getAttribute("data-dirty")).toBe("true");
  });
});

describe("removing this layer's setting does not require dirtying the control", () => {
  it("is reachable on an untouched row that this layer has set", () => {
    // The gesture is "withdraw the setting, let the layer below decide again",
    // which by definition does not change the control's value. Gating it on
    // dirty made it unreachable on every row of the page at once.
    const ctl = mount(field({ key: "nudge_mode", widget: "select", effective: "normal", modified: true, enumValues: ["silent", "normal"] }));

    expect(ctl.getAttribute("data-dirty")).toBe("false");
    expect(reachable(ctl, ctl.querySelector(".fx-revert"))).toBe(true);
    // ...while Save, which SHOULD be gated, is still hidden on the same row.
    expect(saveVisible(ctl)).toBe(false);
  });

  it("is not rendered at all on an inherited row", () => {
    // A remove button on a row this layer never set is a button that does
    // nothing; the fix must not turn "always hidden" into "always shown".
    const ctl = mount(field({ key: "nudge_mode", widget: "select", effective: "normal", modified: false, enumValues: ["silent", "normal"] }));
    expect(ctl.querySelector(".fx-revert")).toBeNull();
  });

  it("does not sit inside the dirty-gated wrapper", () => {
    // The structural statement of the same rule: whatever CSS gates `.fx-actions`
    // in the future, the remove button must not inherit it by containment.
    const ctl = mount(field({ key: "nudge_mode", widget: "select", effective: "normal", modified: true, enumValues: ["silent", "normal"] }));
    const revert = ctl.querySelector<HTMLElement>(".fx-revert")!;
    expect(revert.closest(".fx-actions")).toBeNull();
  });

  it("is separated from the explanation discloser it was confused with", () => {
    // AC8. The `ⓘ` discloser sits against the layer badge in the label column;
    // the remove button sits with the control. They were adjacent, and the one
    // that looked like "cancel this layer" was the one that only expands prose.
    const ctl = mount(field({ key: "nudge_mode", widget: "select", effective: "normal", modified: true, enumValues: ["silent", "normal"] }));
    const revert = ctl.querySelector<HTMLElement>(".fx-revert")!;
    expect(revert.closest(".fctl")).not.toBeNull();
    expect(ctl.querySelector(".fx-disclose")).toBeNull();
  });
});
