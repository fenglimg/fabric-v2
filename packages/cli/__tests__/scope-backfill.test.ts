import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { backfillEntryContent, backfillKnowledgeDir } from "../src/store/scope-backfill.js";

// W3/A5 — clean-slate scope backfill: add semantic_scope + visibility_store,
// repair dirty layer (id-prefix is authoritative), never leak personal → shared.

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function entry(lines: string[]): string {
  return ["---", ...lines, "---", "", "# Body", "", "content", ""].join("\n");
}

describe("backfillEntryContent (unit)", () => {
  it("adds semantic_scope + visibility_store to a team entry missing them", () => {
    const out = backfillEntryContent(
      entry(["id: KT-DEC-0001", "type: decisions", "layer: team", "maturity: proven"]),
      "team",
    );
    expect(out).not.toBeNull();
    expect(out!.change.changed).toEqual(["semantic_scope", "visibility_store"]);
    expect(out!.content).toMatch(/^semantic_scope: team$/mu);
    expect(out!.content).toMatch(/^visibility_store: "team"$/mu);
  });

  it("maps a KP- (personal) id to personal scope + personal store (never shared)", () => {
    const out = backfillEntryContent(
      entry(["id: KP-DEC-9001", "type: decisions", "layer: personal", "maturity: proven"]),
      "team", // even when a team store alias is passed, personal stays personal
    );
    expect(out!.content).toMatch(/^semantic_scope: personal$/mu);
    expect(out!.content).toMatch(/^visibility_store: "personal"$/mu);
  });

  it("repairs a dirty layer (id prefix KP- but layer says team)", () => {
    const out = backfillEntryContent(
      entry(["id: KP-PIT-9001", "type: pitfalls", "layer: team", "maturity: draft"]),
      "team",
    );
    expect(out!.change.changed).toContain("layer");
    expect(out!.content).toMatch(/^layer: personal$/mu);
    expect(out!.content).toMatch(/^semantic_scope: personal$/mu);
  });

  it("is a no-op for an already fully-tagged consistent entry", () => {
    const out = backfillEntryContent(
      entry([
        "id: KT-DEC-0001",
        "type: decisions",
        "layer: team",
        "semantic_scope: team",
        `visibility_store: "team"`,
        "maturity: proven",
      ]),
      "team",
    );
    expect(out!.change.changed).toEqual([]);
  });

  it("returns null for content with no frontmatter", () => {
    expect(backfillEntryContent("# just a heading\n\nbody", "team")).toBeNull();
  });
});

describe("backfillKnowledgeDir (integration)", () => {
  it("backfills a whole knowledge tree and is idempotent", () => {
    const root = mkdtempSync(join(tmpdir(), "fabric-a5-"));
    dirs.push(root);
    const decisions = join(root, "decisions");
    mkdirSync(decisions, { recursive: true });
    writeFileSync(
      join(decisions, "KT-DEC-0001.md"),
      entry(["id: KT-DEC-0001", "type: decisions", "layer: team", "maturity: proven"]),
    );
    writeFileSync(
      join(decisions, "KP-DEC-9001.md"),
      entry(["id: KP-DEC-9001", "type: decisions", "layer: team", "maturity: proven"]),
    );

    const dry = backfillKnowledgeDir(root, { visibilityStore: "team", dryRun: true });
    expect(dry.changes).toHaveLength(2);
    // dry-run wrote nothing
    expect(readFileSync(join(decisions, "KT-DEC-0001.md"), "utf8")).not.toMatch(/semantic_scope/u);

    const applied = backfillKnowledgeDir(root, { visibilityStore: "team" });
    expect(applied.changes).toHaveLength(2);
    const kp = readFileSync(join(decisions, "KP-DEC-9001.md"), "utf8");
    expect(kp).toMatch(/^layer: personal$/mu);
    expect(kp).toMatch(/^visibility_store: "personal"$/mu);

    // Idempotent: a second pass reports zero changes.
    const second = backfillKnowledgeDir(root, { visibilityStore: "team" });
    expect(second.changes).toHaveLength(0);
    expect(second.unchanged).toBe(2);
  });
});
