import { defineCommand } from "citty";
import { execSync } from "node:child_process";
import process from "node:process";
import { resolveDevModeTarget } from "../dev-mode.js";
import syncMetaModule from "./sync-meta.js";
import humanLintModule from "./human-lint.js";
import ledgerAppendModule from "./ledger-append.js";

type CmdLike = { run?: (ctx: { args: Record<string, unknown> }) => unknown | Promise<unknown> };

async function runOrFail(name: string, cmd: CmdLike, args: Record<string, unknown>): Promise<void> {
  try {
    await cmd.run?.({ args });
  } catch (err) {
    process.stderr.write(`fabric pre-commit: ${name} failed — ${(err as Error).message}\n`);
    process.exit(1);
  }
}

export default defineCommand({
  meta: {
    name: "pre-commit",
    description: "复合 pre-commit 钩子 —— 在单一 Node 进程中依次执行 sync-meta --check-only、human-lint、ledger-append --staged，300ms 内完成。",
  },
  args: {
    target: {
      type: "string",
      description: "项目根目录（默认为当前目录或 EXTERNAL_FIXTURE_PATH）。",
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
