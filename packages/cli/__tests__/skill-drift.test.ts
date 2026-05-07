/**
 * SKILL drift contract test (TASK-005)
 *
 * Re-runs scripts/build-skills.ts and compares the output against the
 * committed SKILL.md artifacts in templates/{claude,codex}-skills/.
 *
 * The build script is deterministic: re-running it with an unchanged
 * SOURCE.md/clients.json produces byte-for-byte identical files, so the
 * working tree stays clean after this test.
 *
 * If the test fails it means someone edited SOURCE.md (or clients.json)
 * without regenerating the artifacts.  Fix: run `pnpm build:skills`.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { it } from "vitest";

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

it("SKILL artifacts match canonical source (no drift)", () => {
  // Snapshot committed artifacts BEFORE re-running the build.
  const committed = new Map<string, string>();
  for (const { label, filePath } of COMMITTED_ARTIFACTS) {
    committed.set(label, fs.readFileSync(filePath, "utf8"));
  }

  // Re-run the build script.  Output is written to the same fixed paths, so
  // if there is no drift the files are overwritten with identical content and
  // the working tree remains clean.
  execSync("node --experimental-strip-types scripts/build-skills.ts", {
    cwd: REPO_ROOT,
    stdio: "pipe",
  });

  // Compare regenerated content against the snapshot taken before the run.
  const driftedLabels: string[] = [];
  for (const { label, filePath } of COMMITTED_ARTIFACTS) {
    const regenerated = fs.readFileSync(filePath, "utf8");
    if (regenerated !== committed.get(label)) {
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
