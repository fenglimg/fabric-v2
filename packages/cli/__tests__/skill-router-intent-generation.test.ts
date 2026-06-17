/**
 * B2 skill-router (A3): tests for `installFabricRouterSkill(projectRoot)` — the
 * fabric/ router installer that regenerates the ROUTER_INTENT marker block
 * (Intent Map + S_CLASSIFY task_type enum) from the 7 leaf skill descriptions
 * before the idempotent two-client copy.
 *
 * The contract under test:
 *   (a) both client copies (.claude + .codex) are written byte-identically;
 *   (b) the generated block is bounded by the marker pair exactly once;
 *   (c) ROUND-TRIP oracle (KT-PIT-0014): each Intent Map row is *derived from*
 *       the leaf template's own `Triggers` clause — proven by reading the leaf
 *       template description in the test and asserting its clause appears in the
 *       block (guards against a hardcoded table that would false-green);
 *   (d) the task_type enum lists the 7 leaf slugs (minus `fabric-`) in spec
 *       order;
 *   (e) re-running install is a no-op (idempotent: status skipped).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { installFabricRouterSkill } from "../src/install/skills-and-hooks.ts";
import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
} from "./helpers/init-test-utils.ts";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

const ROUTER_DESTS = [
  ".claude/skills/fabric/SKILL.md",
  ".codex/skills/fabric/SKILL.md",
] as const;

const MARKER_BEGIN = "<!-- fabric:router-intent:begin -->";
const MARKER_END = "<!-- fabric:router-intent:end -->";

// Leaf slugs in FABRIC_SKILL_INSTALL_SPECS declaration order (router excluded).
const LEAF_SLUGS = [
  "fabric-archive",
  "fabric-review",
  "fabric-import",
  "fabric-sync",
  "fabric-store",
  "fabric-audit",
  "fabric-connect",
] as const;

/** Resolve packages/cli/templates/<rel> from this test file's location. */
function templatePath(rel: string): string {
  const here = dirname(fileURLToPath(import.meta.url)); // packages/cli/__tests__
  return resolve(here, "..", "templates", rel);
}

/** Mirror of the installer's leaf-description → Triggers-clause extraction. */
function leafTriggers(slug: string): string {
  const md = readFileSync(templatePath(`skills/${slug}/SKILL.md`), "utf8");
  const fm = md.match(/^---\n([\s\S]*?)\n---/u);
  const desc = fm ? (fm[1]!.match(/^description:\s*(.+?)\s*$/mu)?.[1] ?? "") : "";
  const m = desc.match(/Triggers?\s+([\s\S]+)$/u);
  return m ? m[1]!.trim().replace(/[.。]\s*$/u, "").replace(/\|/gu, "\\|") : "";
}

function sliceBlock(body: string): string {
  const begin = body.indexOf(MARKER_BEGIN);
  const end = body.indexOf(MARKER_END);
  expect(begin).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(begin);
  return body.slice(begin, end + MARKER_END.length);
}

describe("installFabricRouterSkill — Intent Map generation", () => {
  it("writes both client copies with a single marker-bounded generated block", async () => {
    const root = createWerewolfFixtureRoot("fab-router-write");
    tempRoots.push(root);

    const results = await installFabricRouterSkill(root);
    expect(results.every((r) => r.status === "written")).toBe(true);

    const bodies = ROUTER_DESTS.map((rel) => readFileSync(join(root, rel), "utf8"));
    // (a) byte-identical across clients.
    expect(bodies[0]).toBe(bodies[1]);
    for (const body of bodies) {
      // (b) marker pair appears exactly once.
      expect(body.split(MARKER_BEGIN).length - 1).toBe(1);
      expect(body.split(MARKER_END).length - 1).toBe(1);
      // out-of-marker hand-authored prose is preserved.
      expect(body).toContain("### S_CHAIN");
      expect(body).toContain("## Guardrails");
    }
  });

  it("(round-trip) each Intent Map row is derived from the leaf template Triggers clause", async () => {
    const root = createWerewolfFixtureRoot("fab-router-roundtrip");
    tempRoots.push(root);

    await installFabricRouterSkill(root);
    const block = sliceBlock(readFileSync(join(root, ROUTER_DESTS[0]), "utf8"));

    for (const slug of LEAF_SLUGS) {
      const triggers = leafTriggers(slug);
      expect(triggers.length).toBeGreaterThan(0);
      // The row must contain BOTH the leaf's own Triggers clause and its slug —
      // proving the table was generated FROM the leaf description, not hardcoded.
      expect(block).toContain(`| ${triggers} | \`${slug}\` |`);
    }
  });

  it("(enum) task_type enum lists the 7 leaf slugs minus fabric- in spec order", async () => {
    const root = createWerewolfFixtureRoot("fab-router-enum");
    tempRoots.push(root);

    await installFabricRouterSkill(root);
    const block = sliceBlock(readFileSync(join(root, ROUTER_DESTS[0]), "utf8"));

    const expectedEnum = LEAF_SLUGS.map((s) => s.replace(/^fabric-/u, "")).join(" | ");
    expect(block).toContain(`\`${expectedEnum}\``);
  });

  it("(idempotency) re-running install is a no-op", async () => {
    const root = createWerewolfFixtureRoot("fab-router-idempotent");
    tempRoots.push(root);

    const first = await installFabricRouterSkill(root);
    expect(first.every((r) => r.status === "written")).toBe(true);

    const second = await installFabricRouterSkill(root);
    expect(second.every((r) => r.status === "skipped")).toBe(true);
  });
});
