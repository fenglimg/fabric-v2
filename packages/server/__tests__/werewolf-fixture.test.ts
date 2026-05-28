/**
 * v2.0.0-rc.37 F1: werewolf-snapshot fixture loader + invariant guard.
 *
 * Extracts __fixtures__/werewolf-snapshot.tar.gz into a tmp project root,
 * verifies the sanitization invariant (zero /Users/ paths), and runs the real
 * doctor report to confirm the snapshot loads + pins the captured KB
 * invariants (57 canonical entries, 53 draft / 4 verified). The exported
 * `extractWerewolfFixture` helper is reused by the F2 cross-client parity test.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { runDoctorReport } from "../src/services/doctor.js";

const FIXTURE = fileURLToPath(
  new URL("./__fixtures__/werewolf-snapshot.tar.gz", import.meta.url),
);

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) rmSync(tempRoots.pop() as string, { recursive: true, force: true });
});

/**
 * Extract the werewolf snapshot into a fresh tmp project root and return it.
 * The root contains `.fabric/` + a minimal root AGENTS.md so doctor's bootstrap
 * anchor check is satisfied. Caller is responsible for cleanup (or rely on the
 * afterEach in the importing suite).
 */
export function extractWerewolfFixture(register?: (dir: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), "werewolf-fixture-"));
  register?.(root);
  execFileSync("tar", ["-xzf", FIXTURE, "-C", root]);
  // Minimal root anchor so doctor's bootstrap_anchor check passes.
  writeFileSync(join(root, "AGENTS.md"), "# AGENTS\n\n@.fabric/AGENTS.md\n");
  return root;
}

describe("werewolf-snapshot fixture (rc.37 F1)", () => {
  it("extracts with the .fabric tree intact", () => {
    const root = extractWerewolfFixture((d) => tempRoots.push(d));
    expect(existsSync(join(root, ".fabric", "agents.meta.json"))).toBe(true);
    expect(existsSync(join(root, ".fabric", "knowledge"))).toBe(true);
    expect(existsSync(join(root, ".fabric", "events.jsonl"))).toBe(true);
  });

  it("contains zero /Users/ paths (sanitization invariant)", () => {
    const root = extractWerewolfFixture((d) => tempRoots.push(d));
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(p);
        } else if (/\.(json|jsonl|md)$/.test(entry.name)) {
          if (readFileSync(p, "utf8").includes("/Users/")) offenders.push(p);
        }
      }
    };
    walk(join(root, ".fabric"));
    expect(offenders, `unsanitized /Users/ paths:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("loads through doctor + pins captured KB invariants", async () => {
    const root = extractWerewolfFixture((d) => tempRoots.push(d));
    const report = await runDoctorReport(root);

    // agents.meta.json parses (not flagged invalid).
    const metaInvalid = report.checks.find((c) => c.code === "agents_meta_invalid");
    expect(metaInvalid).toBeUndefined();

    // draft_backlog (NEW-38 schema-aware counter) sees 53 draft / 57 total.
    const draftBacklog = report.checks.find((c) => c.name === "Knowledge draft backlog");
    expect(draftBacklog?.message).toContain("53/57");

    // auto-promote info surface fires (settled drafts exist in the snapshot).
    const autoPromote = report.checks.find((c) => c.name === "Knowledge auto-promote");
    expect(autoPromote).toBeDefined();
  });
});
