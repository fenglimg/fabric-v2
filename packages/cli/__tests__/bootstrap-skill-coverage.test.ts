/**
 * Round-trip guard: every skill `fabric install` SHIPS must be named in the
 * bootstrap body that gets injected into the assistant's context.
 *
 * Why this test exists, and why it lives here rather than in packages/shared:
 *
 * The bootstrap body (`packages/shared/src/templates/bootstrap-canonical.ts`) is
 * written straight into both clients' managed block. It is the assistant's
 * inventory of what Fabric can do. A skill the bootstrap does not name is a
 * skill the assistant will never reach for — the build cost is paid, the files
 * are installed, and the capability is unreachable. That is strictly worse than
 * not shipping it: a missing feature costs nothing, a shipped-but-disavowed one
 * costs its full maintenance and returns zero.
 *
 * That is not hypothetical. Both bodies read "Skills (4)" and listed four names
 * while `fabric install` shipped six; `fabric-config` and `fabric-recall-playbook`
 * were dead on arrival for both clients, and nothing anywhere went red. The
 * ZH/EN parity test in packages/shared could not catch it — that package cannot
 * see `packages/cli/templates/skills/`, so it can only assert the two bodies
 * agree with EACH OTHER, which they did, both being wrong.
 *
 * The two facts only meet in this package, so the guard has to be here: the
 * producing side is the templates directory on disk, the consuming side is the
 * bootstrap string. Asserting one against the other is the only check that fails
 * when a new skill is added and the bootstrap is not updated.
 */

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { BOOTSTRAP_CANONICAL_EN, BOOTSTRAP_CANONICAL_ZH } from "@fenglimg/fabric-shared";
import { describe, expect, it } from "vitest";

const skillsDir = fileURLToPath(new URL("../templates/skills", import.meta.url));

/**
 * `lib/` is shared helper content pulled in by the real skills, not a skill the
 * assistant can invoke — it has no SKILL.md and no name to mention.
 */
const NOT_A_SKILL = new Set(["lib"]);

function shippedSkills(): string[] {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !NOT_A_SKILL.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

describe("bootstrap names every shipped skill", () => {
  const bodies = [
    ["ZH", BOOTSTRAP_CANONICAL_ZH],
    ["EN", BOOTSTRAP_CANONICAL_EN],
  ] as const;

  for (const [label, body] of bodies) {
    it(`${label} body mentions every skill directory under templates/skills/`, () => {
      const missing = shippedSkills().filter((name) => !body.includes(name));
      expect(missing, `skills shipped but absent from the ${label} bootstrap`).toEqual([]);
    });

    it(`${label} body's declared skill count matches the number shipped`, () => {
      // The prose carries an explicit count ("Skills (6)"). A stale count is its
      // own defect even when every name is listed: the assistant reads the
      // number as the inventory size and can stop looking after N.
      const declared = /Skills \((\d+)\)/.exec(body);
      expect(declared, `${label} bootstrap lost its "Skills (N)" marker`).not.toBeNull();
      expect(Number(declared?.[1])).toBe(shippedSkills().length);
    });
  }
});
