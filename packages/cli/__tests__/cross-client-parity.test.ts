/**
 * v2.0.0-rc.37 F2: cross-client parity smoke test.
 *
 * Installs Fabric into a fresh project root and verifies the per-client install
 * surface (.claude / .codex / .cursor) is byte-parallel where it must be:
 *   - hook scripts (fabric-hint, knowledge-hint-broad/narrow, cite-policy-evict)
 *     ship to all 3 clients byte-equal;
 *   - shared hook lib/*.cjs ship to all 3 clients byte-equal;
 *   - skill SKILL.md + ref/*.md ship to .claude + .codex byte-equal;
 *   - every client gets a hook-config file.
 *
 * The other "operations" in the G-PARITY gate (doctor / plan-context / archive /
 * review) are CLIENT-AGNOSTIC by construction — all three clients talk to the
 * same stdio MCP server, so their output cannot differ by client. Parity that
 * CAN drift is the install surface, which this test pins. The collected
 * `mismatches` array doubles as the diff report.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { installHooks } from "../src/install/hooks-orchestrator.ts";

// Extract F1's werewolf snapshot for a realistic, .fabric-initialised target.
// Inlined (rather than importing the server test's helper) so vitest does not
// re-run the server suite from this package.
const FIXTURE = fileURLToPath(
  new URL("../../server/__tests__/__fixtures__/werewolf-snapshot.tar.gz", import.meta.url),
);

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) rmSync(tempRoots.pop() as string, { recursive: true, force: true });
});

function extractWerewolfFixture(register: (dir: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), "f2-parity-"));
  register(root);
  execFileSync("tar", ["-xzf", FIXTURE, "-C", root]);
  writeFileSync(join(root, "AGENTS.md"), "# AGENTS\n\n@.fabric/AGENTS.md\n");
  return root;
}

const HOOK_SCRIPTS = [
  "fabric-hint.cjs",
  "knowledge-hint-broad.cjs",
  "knowledge-hint-narrow.cjs",
  "cite-policy-evict.cjs",
];
const HOOK_CLIENTS = [".claude", ".codex", ".cursor"];
const SKILL_CLIENTS = [".claude", ".codex"];
const SKILLS = ["fabric-archive", "fabric-review", "fabric-import"];

function readIf(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

// Assert every present copy of `relPathPerClient(client)` is byte-equal across
// `clients`. Records a mismatch per drifted/absent file. Returns mismatches.
function assertByteParity(
  root: string,
  clients: string[],
  relPathPerClient: (client: string) => string,
  label: string,
  mismatches: string[],
): void {
  const bodies = clients.map((c) => ({ client: c, body: readIf(join(root, relPathPerClient(c))) }));
  const present = bodies.filter((b) => b.body !== null);
  if (present.length === 0) return; // not installed for any client — out of scope
  const reference = present[0].body;
  for (const { client, body } of bodies) {
    if (body === null) {
      mismatches.push(`${label}: missing for ${client}`);
    } else if (body !== reference) {
      mismatches.push(`${label}: ${client} differs from ${present[0].client}`);
    }
  }
}

describe("cross-client install parity (rc.37 F2)", () => {
  it("hooks + lib byte-parallel across 3 clients; skills across 2; configs present", async () => {
    const root = extractWerewolfFixture((d) => tempRoots.push(d));
    await installHooks(root);

    const mismatches: string[] = [];

    // 1. Hook scripts — byte-equal across .claude / .codex / .cursor.
    for (const script of HOOK_SCRIPTS) {
      assertByteParity(root, HOOK_CLIENTS, (c) => join(c, "hooks", script), `hook ${script}`, mismatches);
    }

    // 2. Shared hook lib/*.cjs — byte-equal across all 3 clients. Enumerate
    //    from .claude's lib dir as the reference set.
    const claudeLib = join(root, ".claude", "hooks", "lib");
    if (existsSync(claudeLib)) {
      for (const libFile of readdirSync(claudeLib).filter((f) => f.endsWith(".cjs"))) {
        assertByteParity(root, HOOK_CLIENTS, (c) => join(c, "hooks", "lib", libFile), `lib ${libFile}`, mismatches);
      }
    }

    // 3. Skill SKILL.md + ref/*.md — byte-equal across .claude + .codex.
    for (const skill of SKILLS) {
      assertByteParity(root, SKILL_CLIENTS, (c) => join(c, "skills", skill, "SKILL.md"), `skill ${skill}/SKILL.md`, mismatches);
      const claudeRef = join(root, ".claude", "skills", skill, "ref");
      if (existsSync(claudeRef)) {
        for (const refFile of readdirSync(claudeRef).filter((f) => f.endsWith(".md"))) {
          assertByteParity(
            root,
            SKILL_CLIENTS,
            (c) => join(c, "skills", skill, "ref", refFile),
            `skill ${skill}/ref/${refFile}`,
            mismatches,
          );
        }
      }
    }

    expect(mismatches, `cross-client parity diff report:\n${mismatches.join("\n")}`).toEqual([]);
  });

  it("every client receives a hook-config file", async () => {
    const root = extractWerewolfFixture((d) => tempRoots.push(d));
    await installHooks(root);
    // Claude Code: .claude/settings.json; Codex: .codex/hooks.json or codex
    // config; Cursor: .cursor/hooks.json. At least one config artifact per
    // client root must exist post-install.
    const configPresence = [
      { client: ".claude", candidates: [".claude/settings.json"] },
      { client: ".codex", candidates: [".codex/hooks.json", ".codex/config.toml"] },
      { client: ".cursor", candidates: [".cursor/hooks.json"] },
    ];
    const missing: string[] = [];
    for (const { client, candidates } of configPresence) {
      if (!candidates.some((rel) => existsSync(join(root, rel)))) {
        missing.push(`${client}: none of ${candidates.join(", ")}`);
      }
    }
    expect(missing, `clients missing hook config:\n${missing.join("\n")}`).toEqual([]);
  });
});
