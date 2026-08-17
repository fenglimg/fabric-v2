import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cancel, isCancel, log, select, text } from "@clack/prompts";
import type { FabricConfig } from "@fenglimg/fabric-shared";
import {
  CONFIG_PROFILE_KEYS,
  CONFIG_PROFILE_NAMES,
  CONFIG_PROFILES,
  STORE_LAYOUT,
  buildStoreResolveInput,
  createStoreResolver,
  detectProfile,
  getPanelFields,
  ONBOARD_SLOT_NAMES,
  storeConfigSchema,
  storeRelativePathForMount,
  type ConfigProfileName,
  type PanelFieldMeta,
} from "@fenglimg/fabric-shared";
import { atomicWriteJson } from "@fenglimg/fabric-shared/node/atomic-write";
import { defineCommand } from "citty";

import { paint } from "../colors.js";
import { headerRule } from "../tui/structure.js";
import { resolveClients } from "../config/resolver.js";
import type { ClaudeMcpScope } from "../config/json.js";
import type { ClientKind } from "../config/writer.js";
import type { McpRootPolicy } from "../config/writer.js";
import { t } from "../i18n.js";
import {
  globalConfigPath,
  loadGlobalConfig,
  mutateGlobalConfig,
  resolveGlobalRoot,
} from "../store/global-config-io.js";
// config-view: the read/write router lives beside the console so the CLI panel
// and the web page resolve "what is in effect, and from where" through the same
// code rather than each keeping a copy.
import {
  asPlainObject,
  loadPanelContext,
  resolveEffective,
  resolveWriteTargetStoreRoot,
  writeFieldValue,
  type PanelContext,
  type ValueSource,
} from "../console/config-resolve.js";

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
  // Non-interactive get/set/list surface (ISS-20260713-003 / 010): drives the
  // TTY-less `fabric config --list / --get <key> / --set <key> --value <v>` path.
  list?: boolean;
  get?: string;
  set?: string;
  value?: string;
  json?: boolean;
  // config-single-home W5: which home `--set` writes to.
  scope?: string;
  // config-single-home W8: apply a whole cadence preset instead of single keys.
  profile?: string;
};

/**
 * Apply a cadence profile: write its four keys into one preference segment.
 * Returns the human-readable target, matching writeFieldValue's contract.
 */
async function applyProfile(
  name: ConfigProfileName,
  ctx: PanelContext,
  preferProjectScope: boolean,
): Promise<string> {
  const preset = CONFIG_PROFILES[name];
  const useProject = preferProjectScope && ctx.projectId !== null;
  if (preferProjectScope && ctx.projectId === null) {
    throw new Error(t("cli.config.errors.no-project-id"));
  }
  await mutateGlobalConfig((current) => {
    const base = current ?? { uid: "local", stores: [] };
    if (!useProject) {
      return { ...base, defaults: { ...(base.defaults ?? {}), ...preset } };
    }
    const projects = { ...(base.projects ?? {}) };
    projects[ctx.projectId as string] = { ...(projects[ctx.projectId as string] ?? {}), ...preset };
    return { ...base, projects };
  });
  return useProject ? `global projects.${ctx.projectId as string}` : "global defaults";
}

/** The profile currently in force, resolved through the cascade (null = mixed). */
function activeProfile(ctx: PanelContext): ConfigProfileName | null {
  const fields = getPanelFields();
  const effective: Record<string, unknown> = {};
  for (const key of CONFIG_PROFILE_KEYS) {
    const field = fields.find((f) => (f.key as string) === key);
    if (field === undefined) continue;
    const { value } = resolveEffective(field, ctx);
    effective[key] = value ?? field.default;
  }
  return detectProfile(effective);
}

export type InstallMcpClientsOptions = {
  clients?: ClientKind[];
  dryRun?: boolean;
  localServerPath?: string;
  claudeMcpScope?: ClaudeMcpScope;
  mcpRootPolicy?: McpRootPolicy;
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
// W8: the cadence-profile entry that heads the panel menu.
const PROFILE_CHOICE = "__profile__" as const;

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
    list: {
      type: "boolean",
      description: "List panel-editable config keys (non-interactive)",
    },
    get: {
      type: "string",
      description: "Get one config field by key (non-interactive)",
      valueHint: "key",
    },
    set: {
      type: "string",
      description: "Set one config field by key (non-interactive; requires --value)",
      valueHint: "key",
    },
    value: {
      type: "string",
      description: "Value for --set",
      valueHint: "value",
    },
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON for list/get",
    },
    scope: {
      type: "string",
      description:
        "Where --set writes: defaults (machine-wide, default) | project (this repo's exception) | store (corpus knob, shared via the store repo)",
      valueHint: "defaults|project|store",
    },
    profile: {
      type: "string",
      description:
        "Apply a cadence profile in one step: quiet | standard | coach (honors --scope defaults|project)",
      valueHint: CONFIG_PROFILE_NAMES.join("|"),
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

    // ISS-20260713-003 / 010: non-interactive get/set/list before TTY gate.
    const wantsList = args.list === true;
    const getKey = typeof args.get === "string" && args.get.length > 0 ? args.get : null;
    const setKey = typeof args.set === "string" && args.set.length > 0 ? args.set : null;
    const profileArg =
      typeof args.profile === "string" && args.profile.length > 0 ? args.profile : null;

    // W8: applying a profile is its own action — it writes several keys at once,
    // so it never combines with a single-key --set in the same invocation.
    if (profileArg !== null) {
      if (!(CONFIG_PROFILE_NAMES as readonly string[]).includes(profileArg)) {
        console.error(
          `invalid --profile: ${profileArg} (allowed: ${CONFIG_PROFILE_NAMES.join(", ")})`,
        );
        process.exitCode = 1;
        return;
      }
      const scope = args.scope ?? "defaults";
      if (scope !== "defaults" && scope !== "project") {
        console.error(`--profile writes a preference preset; --scope must be defaults or project`);
        process.exitCode = 1;
        return;
      }
      try {
        const name = profileArg as ConfigProfileName;
        const where = await applyProfile(
          name,
          loadPanelContext(workspaceRoot),
          scope === "project",
        );
        console.log(`applied profile ${name} (${where})`);
        for (const key of CONFIG_PROFILE_KEYS) {
          console.log(`  ${key}=${JSON.stringify(CONFIG_PROFILES[name][key])}`);
        }
      } catch (err: unknown) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
      return;
    }

    if (wantsList || getKey !== null || setKey !== null) {
      try {
        const panel = getPanelFields();
        // W6: read through the same router the panel and the runtime readers use.
        // Reading the repo file here is what made `--list` print `null` for every
        // key while the hooks resolved real values from the global config.
        const ctx = loadPanelContext(workspaceRoot);

        if (wantsList) {
          const rows = panel.map((f) => {
            const { value, source } = resolveEffective(f, ctx);
            return {
              key: f.key,
              // `value` is the value a reader RESOLVES; when no layer set it,
              // that is the shipped default, not `null`.
              value: value ?? f.default,
              type: f.type,
              home: f.home,
              source,
              // W9: the localized copy travels WITH the data so the
              // fabric-config skill explains each knob from this one source
              // instead of restating it (and drifting from it) in its own text.
              label: t(f.label_i18n_key),
              description: t(f.description_i18n_key),
              ...(f.enum_values === undefined ? {} : { allowed: f.enum_values }),
              default: f.default,
            };
          });
          // W8: name the cadence profile in force, or `null` when the four
          // profile keys hold a mix. This is the line the fabric-config skill
          // reads first — "which profile am I on" before "which key is off".
          const profile = activeProfile(ctx);
          if (args.json === true) {
            console.log(
              JSON.stringify(
                {
                  global_config: globalConfigPath(resolveGlobalRoot()),
                  profile,
                  profiles: Object.fromEntries(
                    CONFIG_PROFILE_NAMES.map((n) => [
                      n,
                      {
                        label: t(`cli.config.profile.${n}`),
                        description: t(`cli.config.profile.${n}.description`),
                        keys: CONFIG_PROFILES[n],
                      },
                    ]),
                  ),
                  fields: rows,
                },
                null,
                2,
              ),
            );
          } else {
            console.log(`profile=${profile ?? "custom"}`);
            for (const r of rows) {
              console.log(`${r.key}=${JSON.stringify(r.value)} (${r.source})`);
            }
          }
          return;
        }

        if (getKey !== null) {
          const field = panel.find((f) => (f.key as string) === getKey);
          if (field === undefined) {
            console.error(`unknown config key: ${getKey}`);
            process.exitCode = 1;
            return;
          }
          const { value, source } = resolveEffective(field, ctx);
          const effective = value ?? field.default;
          if (args.json === true) {
            console.log(
              JSON.stringify({ key: getKey, value: effective, source, home: field.home }, null, 2),
            );
          } else {
            console.log(String(effective));
          }
          return;
        }

        if (setKey !== null) {
          if (args.value === undefined) {
            console.error("fabric config --set requires --value");
            process.exitCode = 1;
            return;
          }
          const meta = panel.find((f) => (f.key as string) === setKey);
          const scope = args.scope ?? "defaults";
          if (scope !== "defaults" && scope !== "project" && scope !== "store") {
            console.error(`invalid --scope: ${scope} (allowed: defaults, project, store)`);
            process.exitCode = 1;
            return;
          }

          // Known panel field → validate + coerce through its own metadata, then
          // route by its declared home. `--scope` only chooses BETWEEN the two
          // preference segments; it can never send a key to a home whose readers
          // do not look there (the W5 `--set` path allowed exactly that).
          if (meta !== undefined) {
            const validated = meta.validate(args.value);
            if (!validated.ok) {
              console.error(`invalid value for ${setKey}: ${validated.error}`);
              process.exitCode = 1;
              return;
            }
            if (meta.home !== "preference" && args.scope !== undefined) {
              console.error(
                `${setKey} is a ${meta.home === "corpus" ? "corpus" : "machine"} key — it has a single home, so --scope does not apply`,
              );
              process.exitCode = 1;
              return;
            }
            const where = await writeFieldValue(meta, validated.value, ctx, scope === "project");
            console.log(`set ${setKey}=${JSON.stringify(validated.value)} (${where})`);
            if (meta.home === "corpus") {
              console.log("commit store-config.json in the store repo to share it with the team");
            }
            return;
          }

          // Unknown-to-the-panel key (the power-user JSON surface). No metadata to
          // validate against, so coerce leniently and honor --scope verbatim.
          let coerced: unknown = args.value;
          if (args.value === "true" || args.value === "false") {
            coerced = args.value === "true";
          } else if (args.value.trim() !== "" && Number.isFinite(Number(args.value))) {
            coerced = Number(args.value);
          }
          if (scope === "store") {
            if (ctx.storeRoot === null) {
              console.error(t("cli.config.errors.no-store-target"));
              process.exitCode = 1;
              return;
            }
            const storeConfigPath = join(ctx.storeRoot, STORE_LAYOUT.configFile);
            const next = storeConfigSchema.parse({ ...ctx.storeConfig, [setKey]: coerced });
            await atomicWriteJson(storeConfigPath, next);
            console.log(`set ${setKey}=${JSON.stringify(coerced)} (store: ${ctx.storeRoot})`);
            console.log("commit store-config.json in the store repo to share it with the team");
            return;
          }
          if (scope === "project" && ctx.projectId === null) {
            console.error(t("cli.config.errors.no-project-id"));
            process.exitCode = 1;
            return;
          }
          await mutateGlobalConfig((current) => {
            const base = current ?? { uid: "local", stores: [] };
            if (scope === "defaults") {
              return { ...base, defaults: { ...(base.defaults ?? {}), [setKey]: coerced } };
            }
            const projects = { ...(base.projects ?? {}) };
            projects[ctx.projectId as string] = {
              ...(projects[ctx.projectId as string] ?? {}),
              [setKey]: coerced,
            };
            return { ...base, projects };
          });
          console.log(
            `set ${setKey}=${JSON.stringify(coerced)} (global ${scope === "defaults" ? "defaults" : `projects.${ctx.projectId as string}`})`,
          );
          return;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exitCode = 1;
        return;
      }
    }

    // Non-TTY short-circuit when no get/set/list was requested.
    if (!isInteractiveConfig()) {
      console.log(t("cli.config.intro"));
      console.log(t("cli.config.non-tty-notice"));
      console.log("Hint: fabric config --list | --get <key> | --set <key> --value <v> [--json]");
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

      const fields = getPanelFields();
      // W6: build the displayed values from the SAME router the runtime readers
      // use, so the panel shows the value in force (and which layer set it)
      // instead of the repo file, which holds no policy at all.
      const ctx = loadPanelContext(workspaceRoot);
      const effective = new Map(
        fields.map((f) => [f.key as string, resolveEffective(f, ctx)] as const),
      );
      const current: PanelConfig = Object.fromEntries(
        [...effective].map(([key, r]) => [key, r.value]),
      );

      // W8: the profile sits ABOVE the individual keys. Most people want to say
      // "quieter" once, not tune four numbers, so the first thing the panel
      // offers is the cadence dial; the key list stays below for anyone who
      // does want a specific number.
      const profile = activeProfile(ctx);
      const fieldChoice = await select<string>({
        message: t("cli.config.menu.field-select"),
        options: [
          {
            value: PROFILE_CHOICE,
            label: `${t("cli.config.profile.label")} — ${t("cli.config.value.current", {
              value: profile === null ? t("cli.config.profile.custom") : t(`cli.config.profile.${profile}`),
            })}`,
          },
          ...fields.map((field) => ({
            value: field.key as string,
            label: formatFieldMenuLabel(
              field,
              current,
              effective.get(field.key as string)?.source ?? "default",
            ),
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

      if (fieldChoice === PROFILE_CHOICE) {
        lastFieldKey = PROFILE_CHOICE;
        const picked = await select<string>({
          message: t("cli.config.profile.prompt"),
          options: CONFIG_PROFILE_NAMES.map((name) => ({
            value: name as string,
            label: `${t(`cli.config.profile.${name}`)} — ${t(`cli.config.profile.${name}.description`)}`,
          })),
          initialValue: profile ?? "standard",
        });
        if (isCancel(picked)) {
          cancel(t("cli.config.cancel"));
          return;
        }
        try {
          await applyProfile(picked as ConfigProfileName, loadPanelContext(workspaceRoot), false);
          for (const key of CONFIG_PROFILE_KEYS) {
            if (!editedKeys.includes(key)) editedKeys.push(key);
          }
        } catch (err: unknown) {
          pendingError = t("cli.config.write.failure", {
            message: err instanceof Error ? err.message : String(err),
          });
        }
        continue;
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
        // W6: route to the field's single home. The panel used to write EVERY key
        // into the repo config, where — since W5 made that file identity-only —
        // no reader ever looked: every edit here was silently inert.
        // Re-resolve the context so a concurrent edit is not clobbered by a stale
        // snapshot taken at the top of this render pass.
        await writeFieldValue(field, newValue, loadPanelContext(workspaceRoot), false);
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

function formatFieldMenuLabel(
  field: PanelFieldMeta,
  current: PanelConfig,
  source: ValueSource,
): string {
  const key = field.key as string;
  const rawValue = current[key];
  const display = field.format_for_display(rawValue);
  const isDefault = rawValue === undefined || rawValue === null;
  const labelText = t(field.label_i18n_key);
  // W6: name the layer the value came from. Without it the panel cannot explain
  // why a knob reads one way here and another way in a sibling repo (the same
  // key can be set machine-wide, per-project, or by the shared store).
  const valueLabel = isDefault
    ? `${display} ${t("cli.config.value.default-marker")}`
    : `${display} ${paint.muted(`[${t(`cli.config.source.${source}`)}]`)}`;
  // flat-design: drop the raw `[A_locale]`/`[B_hint_threshold]` group prefix —
  // machine-name noise repeated down the left column. Fields are still ordered by
  // group so same-category knobs cluster; the field label self-describes.
  return `${key} (${labelText}) — ${t("cli.config.value.current", { value: valueLabel })}`;
}

// W6: `readPanelConfig` is gone — reading the repo config was exactly the bug.
// Panel values now come from `loadPanelContext` + `resolveEffective`, the same
// cascade the hooks and the server resolve, so the panel cannot display a value
// that differs from the one in force.

function isInteractiveConfig(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY) && Boolean(process.stderr.isTTY);
}

// Clear viewport + scrollback + home the cursor so the panel re-renders IN PLACE
// each loop instead of the transcript growing downward. `\x1b[3J` drops the
// scrollback so old menus can't be scrolled back to — the stable-panel feel the
// user picked over the accumulating one-shot-prompt transcript.
function clearScreen(): void {
  // ISS-20260711-136: accessible / plain modes must not wipe viewport or scrollback.
  if (
    process.env.FABRIC_CONFIG_PLAIN === "1" ||
    process.env.NO_COLOR !== undefined ||
    process.env.TERM === "dumb" ||
    process.stdout.isTTY !== true
  ) {
    process.stdout.write("\n");
    return;
  }
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
    await writer.write(serverPath, workspaceRoot, undefined, options.mcpRootPolicy);
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
