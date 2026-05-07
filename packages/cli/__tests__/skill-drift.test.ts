/**
 * SKILL drift contract test (TASK-005)
 *
 * Calls buildSkills() with a tmpdir as outputBase, then compares the generated
 * SKILL.md files against the committed artifacts in templates/{claude,codex}-skills/.
 *
 * The build is deterministic: re-running with an unchanged SOURCE.md/clients.json
 * produces byte-for-byte identical files.
 *
 * If the test fails it means someone edited SOURCE.md (or clients.json) without
 * regenerating the artifacts.  Fix: run `pnpm build:skills`.
 */

import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, it } from "vitest";

import { buildSkills } from "../../../scripts/build-skills";

const REPO_ROOT = path.resolve(__dirname, "../../..");

const COMMITTED_ARTIFACTS: Array<{ label: string; filePath: string }> = [
  {
    label: "claude",
    filePath: path.join(
      REPO_ROOT,
      "packages/cli/templates/claude-skills/fabric-init/SKILL.md",
    ),
  },
  {
    label: "codex",
    filePath: path.join(
      REPO_ROOT,
      "packages/cli/templates/codex-skills/fabric-init/SKILL.md",
    ),
  },
];

let tmpOutputBase: string | undefined;

afterAll(async () => {
  if (tmpOutputBase) {
    await rm(tmpOutputBase, { recursive: true, force: true });
  }
});

it("SKILL artifacts match canonical source (no drift)", async () => {
  // Create isolated output directory so we never mutate the working tree
  tmpOutputBase = await mkdtemp(path.join(tmpdir(), "skill-drift-"));

  // Mirror the directory structure buildSkills expects under outputBase
  await fs.promises.mkdir(
    path.join(tmpOutputBase, "packages", "cli", "templates"),
    { recursive: true },
  );

  const { outputs } = await buildSkills({ outputBase: tmpOutputBase });

  const driftedLabels: string[] = [];

  for (const { label, filePath } of COMMITTED_ARTIFACTS) {
    const generated = outputs.get(label);
    if (!generated) {
      driftedLabels.push(`${label} (not generated)`);
      continue;
    }

    const committed = fs.readFileSync(filePath, "utf8");
    if (generated.content !== committed) {
      driftedLabels.push(label);
    }
  }

  if (driftedLabels.length > 0) {
    throw new Error(
      `SKILL drift detected for client(s): ${driftedLabels.join(", ")}.\n` +
        "Committed templates/{claude,codex}-skills/fabric-init/SKILL.md do not match\n" +
        "the output of scripts/build-skills.ts.\n\n" +
        "To fix: edit packages/cli/templates/skill-source/fabric-init/SOURCE.md\n" +
        "(or clients.json) then run `pnpm build:skills` to regenerate.",
    );
  }
});
