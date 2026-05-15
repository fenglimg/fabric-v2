import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cancel, intro, isCancel, log, outro, select, text } from "@clack/prompts";
import type { FabricConfig } from "@fenglimg/fabric-shared";
import { getPanelFields, type PanelFieldMeta } from "@fenglimg/fabric-shared";
import { atomicWriteJson } from "@fenglimg/fabric-shared/node/atomic-write";
import { defineCommand } from "citty";

import { resolveClients } from "../config/resolver.js";
import type { ClaudeMcpScope } from "../config/json.js";
import type { ClientKind } from "../config/writer.js";
import { t } from "../i18n.js";

// ---------------------------------------------------------------------------
// rc.16 TASK-006 (F1-panel): `fab config` is now a clack-based interactive
// menu loop driven by `getPanelFields()` introspection (TASK-005). The panel
// edits `.fabric/fabric-config.json` directly via atomic writes (tmp +
// rename). Top-level CLI flag set: `--target` only — every field choice and
// value entry is interactive (CLI design principle: 能交互选的就别做 flag).
//
// `installMcpClients` (and its helpers `loadFabricConfig` /
// `resolveServerPath`, plus the `InstallMcpClientsResult` type) are PRESERVED
// as named exports because `install.ts` re-imports them via
// `import * as configCommand` to wire MCP entries during the install stage.
// Do NOT remove or rename — that contract is load-bearing for `fab install`.
// ---------------------------------------------------------------------------

type ConfigArgs = {
  target?: string;
};

type InstallMcpClientsOptions = {
  clients?: ClientKind[];
  dryRun?: boolean;
  localServerPath?: string;
  claudeMcpScope?: ClaudeMcpScope;
};

type McpInstallAction = "wrote" | "dry-run" | "skipped";

type McpInstallDetail = {
  client: ClientKind;
  path: string | null;
  action: McpInstallAction;
};

export type InstallMcpClientsResult = {
  installed: ClientKind[];
  skipped: ClientKind[];
  details: McpInstallDetail[];
};

// `fabric.config.json` (workspace-root) — legacy MCP-clients config consumed
// by `installMcpClients` only. The panel targets `.fabric/fabric-config.json`
// (see PANEL_CONFIG_RELATIVE_PATH below).
async function loadFabricConfig(workspaceRoot: string): Promise<FabricConfig> {
  const configPath = resolve(workspaceRoot, "fabric.config.json");
  if (!existsSync(configPath)) {
    return {};
  }

  const parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(t("cli.config.errors.expected-object", { path: configPath }));
  }

  return parsed as FabricConfig;
}

function resolveServerPath(override?: string): string {
  if (override) return override;
  if (process.env.FAB_SERVER_PATH) return resolve(process.env.FAB_SERVER_PATH);
  return fileURLToPath(import.meta.resolve("@fenglimg/fabric-server"));
}

// `.fabric/fabric-config.json` — panel-managed config (Group A/B/C fields
// per TASK-005's getPanelFields()). Created by `fab install`'s
// writeDefaultFabricConfig.
const PANEL_CONFIG_RELATIVE_PATH = [".fabric", "fabric-config.json"] as const;

const EXIT_CHOICE = "__exit__" as const;

type PanelConfig = Record<string, unknown>;

export const configCmd = defineCommand({
  meta: {
    name: "config",
    description: t("cli.config.description"),
  },
  args: {
    target: {
      type: "string",
      description: t("cli.config.args.target.description"),
      valueHint: "path",
    },
  },
  async run({ args }: { args: ConfigArgs }) {
    const workspaceRoot = resolve(args.target ?? process.cwd());
    const configPath = join(workspaceRoot, ...PANEL_CONFIG_RELATIVE_PATH);
    const fabricDir = join(workspaceRoot, ".fabric");

    // Uninit-workspace gate. Both `.fabric/` AND
    // `.fabric/fabric-config.json` must exist; either missing means the user
    // hasn't run `fab install` yet. Per CLI design principle (drift -> abort,
    // never auto-bootstrap), we exit 1 with a hint pointing at `fab install`.
    const fabricDirOk = existsSync(fabricDir) && statSync(fabricDir).isDirectory();
    const configOk = fabricDirOk && existsSync(configPath);
    if (!configOk) {
      console.error(t("cli.config.errors.uninit-workspace.message"));
      process.exitCode = 1;
      return;
    }

    // Non-TTY short-circuit. clack prompts require a TTY for keyboard input;
    // running `fab config` from a non-interactive shell (CI, snapshot tests,
    // pipes) prints the intro + a one-line notice and exits 0 instead of
    // hanging. The interactive workflow is the only supported edit path.
    if (!isInteractiveConfig()) {
      console.log(t("cli.config.intro"));
      console.log(t("cli.config.non-tty-notice"));
      return;
    }

    intro(t("cli.config.intro"));

    // Menu loop. Re-read the config each iteration so concurrent edits (e.g.
    // a parallel terminal manually editing the JSON) don't get stomped.
    let edited = false;
    while (true) {
      const current = await readPanelConfig(configPath);
      const fields = getPanelFields();

      const fieldChoice = await select<string>({
        message: t("cli.config.menu.field-select"),
        options: [
          ...fields.map((field) => ({
            value: field.key as string,
            label: formatFieldMenuLabel(field, current),
          })),
          { value: EXIT_CHOICE, label: t("cli.config.menu.exit") },
        ],
      });

      if (isCancel(fieldChoice)) {
        cancel(t("cli.config.cancel"));
        return;
      }

      if (fieldChoice === EXIT_CHOICE) {
        outro(edited ? t("cli.config.outro") : t("cli.config.outro-no-changes"));
        return;
      }

      const field = fields.find((f) => (f.key as string) === fieldChoice);
      if (!field) {
        // Defensive: select() should only emit values we provided.
        log.warn(t("cli.config.errors.unknown-field"));
        continue;
      }

      const newValue = await promptFieldValue(field, current);
      if (newValue === CANCELLED) {
        cancel(t("cli.config.cancel"));
        return;
      }
      if (newValue === SKIPPED) {
        continue;
      }

      try {
        const refreshed = await readPanelConfig(configPath);
        const merged: PanelConfig = { ...refreshed, [field.key as string]: newValue };
        await atomicWriteJson(configPath, merged);
        edited = true;
        log.success(
          t("cli.config.write.success", {
            key: field.key as string,
            value: field.format_for_display(newValue),
          }),
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(t("cli.config.write.failure", { message }));
      }
    }
  },
});

export default configCmd;

// ---------------------------------------------------------------------------
// Panel helpers
// ---------------------------------------------------------------------------

const CANCELLED = Symbol("config-cancelled");
const SKIPPED = Symbol("config-skipped");

type PromptOutcome = string | number | typeof CANCELLED | typeof SKIPPED;

async function promptFieldValue(
  field: PanelFieldMeta,
  current: PanelConfig,
): Promise<PromptOutcome> {
  const currentValue = current[field.key as string];
  const currentDisplay = field.format_for_display(currentValue);

  if (field.widget === "select") {
    const enumValues = field.enum_values ?? [];
    if (enumValues.length === 0) {
      // Defensive guard — getPanelFields() always populates enum_values for
      // select widgets, but a future schema regression should not crash here.
      log.warn(t("cli.config.errors.no-enum-options"));
      return SKIPPED;
    }
    const initialValue = enumValues.includes(String(currentValue))
      ? String(currentValue)
      : enumValues.includes(String(field.default))
        ? String(field.default)
        : enumValues[0];
    const picked = await select<string>({
      message: t("cli.config.prompt.select", {
        key: field.key as string,
        current: currentDisplay,
      }),
      options: enumValues.map((value) => ({ value, label: value })),
      initialValue,
    });
    if (isCancel(picked)) {
      return CANCELLED;
    }
    const result = field.validate(String(picked));
    if (!result.ok) {
      log.error(result.error);
      return SKIPPED;
    }
    return result.value as string;
  }

  // widget === "text" → positive-integer threshold
  const entered = await text({
    message: t("cli.config.prompt.text", {
      key: field.key as string,
      current: currentDisplay,
    }),
    placeholder: currentDisplay,
    initialValue: currentDisplay,
    validate(raw) {
      const result = field.validate(raw);
      return result.ok ? undefined : result.error;
    },
  });
  if (isCancel(entered)) {
    return CANCELLED;
  }
  const finalResult = field.validate(String(entered));
  if (!finalResult.ok) {
    // Should be unreachable — text()'s validate runs before this — but treat
    // a late failure as a skip rather than a crash.
    log.error(finalResult.error);
    return SKIPPED;
  }
  return finalResult.value as number;
}

function formatFieldMenuLabel(field: PanelFieldMeta, current: PanelConfig): string {
  const key = field.key as string;
  const rawValue = current[key];
  const display = field.format_for_display(rawValue);
  const isDefault = rawValue === undefined || rawValue === null;
  const labelText = t(field.label_i18n_key);
  const valueLabel = isDefault
    ? `${display} ${t("cli.config.value.default-marker")}`
    : display;
  return `[${field.group}] ${key} (${labelText}) — ${t("cli.config.value.current", { value: valueLabel })}`;
}

async function readPanelConfig(configPath: string): Promise<PanelConfig> {
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(t("cli.config.errors.expected-object", { path: configPath }));
  }
  return parsed as PanelConfig;
}

function isInteractiveConfig(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY) && Boolean(process.stderr.isTTY);
}

// ---------------------------------------------------------------------------
// installMcpClients — preserved verbatim for install.ts re-import contract.
// ---------------------------------------------------------------------------

export async function installMcpClients(
  target: string,
  options: InstallMcpClientsOptions = {},
): Promise<InstallMcpClientsResult> {
  const workspaceRoot = resolve(target);
  const fabricConfig = await loadFabricConfig(workspaceRoot);
  const selectedClients = options.clients === undefined ? null : new Set(options.clients);
  const serverPath = resolveServerPath(options.localServerPath);
  const writers = resolveClients(workspaceRoot, fabricConfig, { claudeMcpScope: options.claudeMcpScope }).filter((writer) =>
    selectedClients === null ? true : selectedClients.has(writer.clientKind),
  );
  const installed: ClientKind[] = [];
  const skipped: ClientKind[] = [];
  const details: McpInstallDetail[] = [];

  for (const writer of writers) {
    const configPath = await writer.detect(workspaceRoot);
    if (configPath === null) {
      skipped.push(writer.clientKind);
      details.push({ client: writer.clientKind, path: null, action: "skipped" });
      continue;
    }

    if (options.dryRun) {
      skipped.push(writer.clientKind);
      details.push({ client: writer.clientKind, path: configPath, action: "dry-run" });
      continue;
    }

    await writer.write(serverPath, workspaceRoot);
    installed.push(writer.clientKind);
    details.push({ client: writer.clientKind, path: configPath, action: "wrote" });
  }

  return { installed, skipped, details };
}
