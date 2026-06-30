import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cancel, isCancel, log, select, text } from "@clack/prompts";
import type { FabricConfig } from "@fenglimg/fabric-shared";
import {
  getPanelFields,
  ONBOARD_SLOT_NAMES,
  type PanelFieldMeta,
} from "@fenglimg/fabric-shared";
import { atomicWriteJson } from "@fenglimg/fabric-shared/node/atomic-write";
import { defineCommand } from "citty";

import { paint } from "../colors.js";
import { headerRule } from "../tui/structure.js";
import { resolveClients } from "../config/resolver.js";
import type { ClaudeMcpScope } from "../config/json.js";
import type { ClientKind } from "../config/writer.js";
import { t } from "../i18n.js";
import {
  loadGlobalConfig,
  resolveGlobalRoot,
  saveGlobalConfig,
} from "../store/global-config-io.js";

// grill-6fixes (D1): the language base tone is a single machine-wide value in
// `~/.fabric/fabric-global.json`, not a per-project field. The panel still
// surfaces it under this key, but read/write are routed to the global config.
const LANGUAGE_FIELD_KEY = "fabric_language";

// ---------------------------------------------------------------------------
// rc.16 TASK-006 (F1-panel): `fabric config` is now a clack-based interactive
// menu loop driven by `getPanelFields()` introspection (TASK-005). The panel
// edits `.fabric/fabric-config.json` directly via atomic writes (tmp +
// rename). Top-level CLI flag set: `--target` only — every field choice and
// value entry is interactive (CLI design principle: 能交互选的就别做 flag).
//
// `installMcpClients` (and its helpers `loadFabricConfig` /
// `resolveServerPath`, plus the `InstallMcpClientsResult` type) are PRESERVED
// as named exports because `install.ts` re-imports them via
// `import * as configCommand` to wire MCP entries during the install stage.
// Do NOT remove or rename — that contract is load-bearing for `fabric install`.
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
  /**
   * TASK-004/Bug-A: the subset of `installed` whose target file content actually
   * changed this run. An idempotent re-write (byte-identical before/after) is NOT
   * counted, so the mcp stage can report changed=false on a settled re-install
   * even though it still lists every configured client in `installed` for display.
   */
  changed: ClientKind[];
};

// `.fabric/fabric-config.json` — the single project-config source of truth (A1).
// Consumed here by `installMcpClients` for MCP-client settings; the same file
// also backs the panel (PANEL_CONFIG_RELATIVE_PATH below) and the server runtime.
async function loadFabricConfig(workspaceRoot: string): Promise<FabricConfig> {
  const configPath = resolve(workspaceRoot, ".fabric", "fabric-config.json");
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
// per TASK-005's getPanelFields()). Created by `fabric install`'s
// writeDefaultFabricConfig.
const PANEL_CONFIG_RELATIVE_PATH = [".fabric", "fabric-config.json"] as const;

const EXIT_CHOICE = "__exit__" as const;

type PanelConfig = Record<string, unknown>;

// ---------------------------------------------------------------------------
// v2.0.0-rc.23 TASK-014 (F8c): onboard-slot opt-out helpers.
//
// `fabric config dismiss-slot <slot>` is invoked by fabric-archive's first-run
// onboard phase when the user picks "dismiss" — it appends the slot name to
// `onboard_slots_opted_out` in `.fabric/fabric-config.json` so subsequent
// `fabric onboard-coverage` runs treat the slot as resolved (no missing report).
//
// `fabric config onboard-reset <slot>` is the reverse — it removes the slot
// from the opted-out list. Naming discipline: `dismiss-slot` = add to list,
// `onboard-reset` = remove from list. Keeping the verbs distinct prevents
// users from accidentally re-prompting a deliberately dismissed slot.
//
// Both subcommands are non-interactive (no clack prompts) — they're meant
// to be invoked programmatically by the Skill OR typed directly by the user.
// ---------------------------------------------------------------------------

type SlotMutationArgs = {
  slot?: string;
  target?: string;
};

async function readOnboardSlotsList(configPath: string): Promise<{
  config: Record<string, unknown>;
  optedOut: string[];
}> {
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(t("cli.config.errors.expected-object", { path: configPath }));
  }
  const obj = parsed as Record<string, unknown>;
  const list = obj.onboard_slots_opted_out;
  const optedOut = Array.isArray(list)
    ? list.filter((v): v is string => typeof v === "string")
    : [];
  return { config: obj, optedOut };
}

function ensureUninitGate(workspaceRoot: string): string | null {
  const configPath = join(workspaceRoot, ...PANEL_CONFIG_RELATIVE_PATH);
  const fabricDir = join(workspaceRoot, ".fabric");
  const fabricDirOk = existsSync(fabricDir) && statSync(fabricDir).isDirectory();
  const configOk = fabricDirOk && existsSync(configPath);
  if (!configOk) {
    console.error(t("cli.config.errors.uninit-workspace.message"));
    return null;
  }
  return configPath;
}

function validateSlotArg(slot: string | undefined): string | null {
  const slots = ONBOARD_SLOT_NAMES.join(", ");
  if (slot === undefined || slot.length === 0) {
    console.error(`${paint.error("✗")} ${t("cli.config.slot.errors.missing", { slots })}`);
    return null;
  }
  if (!(ONBOARD_SLOT_NAMES as readonly string[]).includes(slot)) {
    console.error(`${paint.error("✗")} ${t("cli.config.slot.errors.unknown", { slot, slots })}`);
    return null;
  }
  return slot;
}

const dismissSlotCmd = defineCommand({
  meta: {
    name: "dismiss-slot",
    description:
      "Add an S5 onboard slot to the opted-out list (fabric-archive Skill onboard phase invokes this).",
    hidden: true,
  },
  args: {
    slot: {
      type: "positional",
      description: "Slot name to dismiss (one of the locked S5 set).",
      required: true,
    },
    target: {
      type: "string",
      description: "Override the project root (defaults to cwd).",
    },
  },
  async run({ args }: { args: SlotMutationArgs }) {
    const slot = validateSlotArg(args.slot);
    if (slot === null) {
      process.exitCode = 1;
      return;
    }
    const workspaceRoot = resolve(args.target ?? process.cwd());
    const configPath = ensureUninitGate(workspaceRoot);
    if (configPath === null) {
      process.exitCode = 1;
      return;
    }
    try {
      const { config, optedOut } = await readOnboardSlotsList(configPath);
      if (optedOut.includes(slot)) {
        console.log(paint.muted(t("cli.config.slot.dismiss.already", { slot })));
        return;
      }
      const next = [...optedOut, slot];
      const merged = { ...config, onboard_slots_opted_out: next };
      await atomicWriteJson(configPath, merged);
      console.log(`${paint.success("✓")} ${t("cli.config.slot.dismiss.done", { slot })}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${paint.error("✗")} ${t("cli.config.slot.dismiss.failed", { message })}`);
      process.exitCode = 1;
    }
  },
});

const onboardResetCmd = defineCommand({
  meta: {
    name: "onboard-reset",
    description:
      "Remove an S5 onboard slot from the opted-out list — re-opens the slot for future fabric-archive onboard prompts.",
    hidden: true,
  },
  args: {
    slot: {
      type: "positional",
      description: "Slot name to reset (one of the locked S5 set).",
      required: true,
    },
    target: {
      type: "string",
      description: "Override the project root (defaults to cwd).",
    },
  },
  async run({ args }: { args: SlotMutationArgs }) {
    const slot = validateSlotArg(args.slot);
    if (slot === null) {
      process.exitCode = 1;
      return;
    }
    const workspaceRoot = resolve(args.target ?? process.cwd());
    const configPath = ensureUninitGate(workspaceRoot);
    if (configPath === null) {
      process.exitCode = 1;
      return;
    }
    try {
      const { config, optedOut } = await readOnboardSlotsList(configPath);
      if (!optedOut.includes(slot)) {
        console.log(paint.muted(t("cli.config.slot.reset.not-opted", { slot })));
        return;
      }
      const next = optedOut.filter((s) => s !== slot);
      const merged = { ...config, onboard_slots_opted_out: next };
      await atomicWriteJson(configPath, merged);
      console.log(`${paint.success("✓")} ${t("cli.config.slot.reset.done", { slot })}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${paint.error("✗")} ${t("cli.config.slot.reset.failed", { message })}`);
      process.exitCode = 1;
    }
  },
});

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
  subCommands: {
    "dismiss-slot": dismissSlotCmd,
    "onboard-reset": onboardResetCmd,
  },
  async run({ args }: { args: ConfigArgs }) {
    // v2.0.0-rc.23 TASK-014 (F8c): citty runs the parent `run` AFTER routing
    // to a matched subcommand. The subcommands (`dismiss-slot` /
    // `onboard-reset`) do their own work; we must NOT also launch the
    // interactive panel after them. Short-circuit by detecting the subcommand
    // name in process.argv.
    //
    // F60 (ISS-20260531-...): a strict `process.argv[3]` check only worked when
    // the subcommand was the FIRST token after `config`. With a flag in front
    // (`fabric config --target ./p dismiss-slot`) argv[3] was `--target`, so the
    // short-circuit was bypassed and the interactive panel/uninit-gate launched
    // ON TOP of the already-run subcommand. Scan every arg after `config`
    // instead so the detection is order-independent.
    const argvAfterConfig = process.argv.slice(3);
    if (argvAfterConfig.includes("dismiss-slot") || argvAfterConfig.includes("onboard-reset")) {
      return;
    }

    const workspaceRoot = resolve(args.target ?? process.cwd());
    const configPath = join(workspaceRoot, ...PANEL_CONFIG_RELATIVE_PATH);
    const fabricDir = join(workspaceRoot, ".fabric");

    // Uninit-workspace gate. Both `.fabric/` AND
    // `.fabric/fabric-config.json` must exist; either missing means the user
    // hasn't run `fabric install` yet. Per CLI design principle (drift -> abort,
    // never auto-bootstrap), we exit 1 with a hint pointing at `fabric install`.
    const fabricDirOk = existsSync(fabricDir) && statSync(fabricDir).isDirectory();
    const configOk = fabricDirOk && existsSync(configPath);
    if (!configOk) {
      console.error(t("cli.config.errors.uninit-workspace.message"));
      process.exitCode = 1;
      return;
    }

    // Non-TTY short-circuit. clack prompts require a TTY for keyboard input;
    // running `fabric config` from a non-interactive shell (CI, snapshot tests,
    // pipes) prints the intro + a one-line notice and exits 0 instead of
    // hanging. The interactive workflow is the only supported edit path.
    if (!isInteractiveConfig()) {
      console.log(t("cli.config.intro"));
      console.log(t("cli.config.non-tty-notice"));
      return;
    }

    // Interactive stable panel (用户裁决 2026-06-29): clack's `select` is a one-shot
    // prompt, so looping it re-printed the whole 16-item menu every pass and the
    // transcript kept growing downward (`◇` collapsed lines + receipt stacking up —
    // the "一直往上滚" weirdness the user flagged). Instead we CLEAR the screen each
    // pass and re-render a FIXED panel in place: B-横线 title + a persistent "已改"
    // line + the menu (values refreshed live). The per-edit ✓ receipt is dropped —
    // it would only flash before the next clear; the durable confirmation is now the
    // "已改" header line plus the menu's own `当前: <new value>`.
    const editedKeys: string[] = [];
    // Remember the last-touched field so the menu re-opens with the cursor on it
    // (not bouncing back to the top) — you usually tweak the same few knobs in a row.
    let lastFieldKey: string | undefined;
    // An action error (write failure / uninit) is carried to the NEXT render so it
    // survives the clear (it would otherwise vanish instantly); shown once, then cleared.
    let pendingError: string | null = null;
    while (true) {
      clearScreen();
      writePanelHeader(editedKeys, pendingError);
      pendingError = null;

      const current = await readPanelConfig(configPath);
      // grill-6fixes (D1): overlay the global language onto the in-memory panel
      // config so the language entry's menu label reflects the machine-wide
      // tone (the project file no longer carries `fabric_language`).
      const globalLanguage = loadGlobalConfig(resolveGlobalRoot())?.language;
      if (globalLanguage !== undefined) {
        current[LANGUAGE_FIELD_KEY] = globalLanguage;
      }
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
        initialValue: lastFieldKey,
      });

      if (isCancel(fieldChoice)) {
        cancel(t("cli.config.cancel"));
        return;
      }

      if (fieldChoice === EXIT_CHOICE) {
        // Final frame: clear once more, re-print the title + a single flat closing
        // line (saved / no-changes). No clack `outro` block — flat output only.
        clearScreen();
        writePanelHeader(editedKeys, null);
        console.log(
          editedKeys.length > 0
            ? paint.success(t("cli.config.outro"))
            : paint.muted(t("cli.config.outro-no-changes")),
        );
        return;
      }

      const field = fields.find((f) => (f.key as string) === fieldChoice);
      if (!field) {
        // Defensive: select() should only emit values we provided.
        pendingError = t("cli.config.errors.unknown-field");
        continue;
      }
      // Park the cursor here on the next menu pass (return-to-last-edited).
      lastFieldKey = fieldChoice;

      const newValue = await promptFieldValue(field, current);
      if (newValue === CANCELLED) {
        cancel(t("cli.config.cancel"));
        return;
      }
      if (newValue === SKIPPED) {
        continue;
      }

      try {
        if ((field.key as string) === LANGUAGE_FIELD_KEY) {
          // grill-6fixes (D1): language persists to the GLOBAL config, not the
          // project file. The uninit gate guarantees `fabric install` already
          // ran, so a global config exists.
          const globalRoot = resolveGlobalRoot();
          const globalConfig = loadGlobalConfig(globalRoot);
          if (globalConfig === null) {
            pendingError = t("cli.config.errors.uninit-workspace.message");
            continue;
          }
          saveGlobalConfig(
            { ...globalConfig, language: newValue as "zh-CN" | "en" },
            globalRoot,
          );
        } else {
          const refreshed = await readPanelConfig(configPath);
          const merged: PanelConfig = { ...refreshed, [field.key as string]: newValue };
          await atomicWriteJson(configPath, merged);
        }
        // Record the edit for the persistent "已改" header line (de-duped, order-preserving).
        if (!editedKeys.includes(field.key as string)) {
          editedKeys.push(field.key as string);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        pendingError = t("cli.config.write.failure", { message });
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
      const result = field.validate(raw ?? "");
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
  // flat-design: drop the raw `[A_locale]`/`[B_hint_threshold]` group prefix —
  // machine-name noise repeated down the left column. Fields are still ordered by
  // group so same-category knobs cluster; the field label self-describes.
  return `${key} (${labelText}) — ${t("cli.config.value.current", { value: valueLabel })}`;
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

// Clear viewport + scrollback + home the cursor so the panel re-renders IN PLACE
// each loop instead of the transcript growing downward. `\x1b[3J` drops the
// scrollback so old menus can't be scrolled back to — the stable-panel feel the
// user picked over the accumulating one-shot-prompt transcript.
function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
}

// The fixed panel header re-printed every render: B-横线 title, an optional one-shot
// error line (carried across the clear), and the persistent "已改" line listing the
// keys touched this session (the durable save confirmation now that the per-edit
// receipt is gone).
function writePanelHeader(editedKeys: string[], pendingError: string | null): void {
  console.log(headerRule(t("cli.config.intro")));
  if (pendingError !== null) {
    console.log(`${paint.error("✗")} ${pendingError}`);
  }
  if (editedKeys.length > 0) {
    console.log(
      paint.muted(
        t("cli.config.panel.edited", {
          count: String(editedKeys.length),
          keys: editedKeys.join(", "),
        }),
      ),
    );
  }
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
  const changed: ClientKind[] = [];

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

    // TASK-004/Bug-A: snapshot the target file BEFORE the (unconditional) write,
    // then compare AFTER, so an idempotent re-write doesn't read as a real change.
    const before = await readFileIfExists(configPath);
    await writer.write(serverPath, workspaceRoot);
    const after = await readFileIfExists(configPath);
    installed.push(writer.clientKind);
    if (before !== after) {
      changed.push(writer.clientKind);
    }
    details.push({ client: writer.clientKind, path: configPath, action: "wrote" });
  }

  return { installed, skipped, details, changed };
}

/** Read a file's content, or null when it does not exist / is unreadable. */
async function readFileIfExists(path: string): Promise<string | null> {
  if (!existsSync(path)) return null;
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}
