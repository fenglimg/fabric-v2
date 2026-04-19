import { defineCommand } from "citty";
import process from "node:process";

import { resolveDevModeTarget } from "../dev-mode.js";
import { t } from "../i18n.js";
import syncMetaModule from "./sync-meta.js";
import humanLintModule from "./human-lint.js";
import ledgerAppendModule from "./ledger-append.js";

type CmdLike = { run?: (ctx: { args: Record<string, unknown> }) => unknown | Promise<unknown> };

async function runOrFail(name: string, cmd: CmdLike, args: Record<string, unknown>): Promise<void> {
  try {
    await cmd.run?.({ args });
  } catch (err) {
    process.stderr.write(
      `${t("cli.pre-commit.run-failed", { name, message: (err as Error).message })}\n`,
    );
    process.exit(1);
  }
}

export default defineCommand({
  meta: {
    name: "pre-commit",
    description: t("cli.pre-commit.description"),
  },
  args: {
    target: {
      type: "string",
      description: t("cli.pre-commit.args.target.description"),
    },
  },
  async run({ args }) {
    const target = resolveDevModeTarget(args.target as string | undefined);

    // 1. sync-meta --check-only — fail if drift detected
    await runOrFail("sync-meta --check-only", syncMetaModule as CmdLike, {
      target,
      "check-only": true,
    });

    // 2. human-lint — fail if @HUMAN sections modified
    await runOrFail("human-lint", humanLintModule as CmdLike, { target });

    // 3. ledger-append --staged — append intent entry for this commit
    //    Only runs when there is actually a staged diff (handled inside ledger-append).
    await runOrFail("ledger-append --staged", ledgerAppendModule as CmdLike, {
      target,
      staged: true,
    });

    // Exit 0 implicitly — caller (.husky/pre-commit) handles the .fabric/agents.meta.json guard separately.
  },
});
