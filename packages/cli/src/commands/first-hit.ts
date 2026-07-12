import { defineCommand } from "citty";

import { paint } from "../colors.js";
import { t } from "../i18n.js";
import {
  assessFirstHit,
  resolveStoreDirForAlias,
  seedStarterKnowledge,
} from "../store/first-hit.js";
import { resolveGlobalRoot } from "../store/global-config-io.js";
import { loadProjectConfig } from "../store/project-config-io.js";

// ---------------------------------------------------------------------------
// `fabric first-hit` — prove (or diagnose) install → first knowledge hit path.
//
// Exit codes (stable for scripts / dogfood / CI):
//   0 = first_hit_ok
//   1 = unexpected throw
//   2+ = readiness failure (code-specific; see assessFirstHit)
// ---------------------------------------------------------------------------

type FirstHitArgs = {
  target?: string;
  json?: boolean;
  seed?: boolean;
  paths?: string;
};

export default defineCommand({
  meta: {
    name: "first-hit",
    description: t("cli.first-hit.description"),
  },
  args: {
    target: {
      type: "string",
      description: t("cli.first-hit.args.target.description"),
    },
    json: {
      type: "boolean",
      description: t("cli.first-hit.args.json.description"),
    },
    seed: {
      type: "boolean",
      description: t("cli.first-hit.args.seed.description"),
    },
    paths: {
      type: "string",
      description: t("cli.first-hit.args.paths.description"),
    },
  },
  async run({ args }: { args: FirstHitArgs }) {
    const projectRoot = args.target ?? process.cwd();
    const globalRoot = resolveGlobalRoot();

    try {
      if (args.seed === true) {
        await runSeed(projectRoot, globalRoot, args.json === true);
      }

      const probePath =
        typeof args.paths === "string" && args.paths.trim().length > 0
          ? args.paths.split(",")[0]?.trim()
          : undefined;

      const report = await assessFirstHit({
        projectRoot,
        globalRoot,
        ...(probePath === undefined ? {} : { probePath }),
      });

      if (args.json === true) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        process.stdout.write(renderHuman(report));
      }
      process.exitCode = report.exit_code;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${paint.error("✗")} first-hit failed: ${message}\n`);
      process.exitCode = 1;
    }
  },
});

function renderHuman(report: Awaited<ReturnType<typeof assessFirstHit>>): string {
  const mark = report.ok ? paint.success("✓") : paint.error("✗");
  const lines = [
    `${mark} ${report.code}: ${report.message}`,
    `  write_target: ${report.write_target ?? "(none)"}`,
    `  total_entries: ${report.total_entries}`,
    `  hooks: session_start=${report.hooks.session_start} pre_tool_use=${report.hooks.pre_tool_use}`,
  ];
  if (report.bound_stores.length > 0) {
    lines.push("  stores:");
    for (const s of report.bound_stores) {
      lines.push(`    - ${s.alias}: ${s.entry_count} entries${s.sample_ids.length ? ` (${s.sample_ids.slice(0, 3).join(", ")})` : ""}`);
    }
  }
  if (report.remediations.length > 0) {
    lines.push("  next:");
    for (const r of report.remediations) {
      lines.push(`    · ${r}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function runSeed(
  projectRoot: string,
  globalRoot: string,
  asJson: boolean,
): Promise<void> {
  const project = loadProjectConfig(projectRoot);
  const alias = project?.active_write_store;
  if (typeof alias !== "string" || alias.length === 0) {
    throw new Error(
      "cannot --seed: no active_write_store. Run `fabric store create … && fabric store bind … && fabric store switch-write …` first.",
    );
  }
  const dir = resolveStoreDirForAlias(alias, globalRoot);
  if (dir === null) {
    throw new Error(`cannot --seed: store '${alias}' is not mounted under ${globalRoot}`);
  }
  const result = await seedStarterKnowledge(dir, {
    layer: alias.includes("personal") ? "personal" : "team",
  });
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ seed: result }, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `${paint.success("✓")} seeded ${result.files.length} starter entr${result.files.length === 1 ? "y" : "ies"} into '${alias}' (${result.ids.join(", ")})\n`,
  );
}
