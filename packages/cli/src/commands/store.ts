import type { MountedStore } from "@fenglimg/fabric-shared";
import { confirm, isCancel } from "@clack/prompts";
import { defineCommand } from "citty";
import { join } from "node:path";

import { paint, symbol } from "../colors.js";
import { getProjectTranslator, t } from "../i18n.js";
import { grid, groupDot, headerRule } from "../tui/structure.js";

import { regenerateBindingsSnapshot } from "../store/bindings-io.js";
import { backfillKnowledgeDir } from "../store/scope-backfill.js";
import { loadProjectConfig } from "../store/project-config-io.js";
import {
  promoteProjectToTeam,
  rescopeStore,
  type RescopeReport,
} from "../store/store-rescope.js";
import {
  assertStoreMountable,
  resolveStoreDir,
  storeAdd,
  storeBind,
  storeCreate,
  storeExplain,
  storeGitRemote,
  storeList,
  storeProjectCreate,
  storeProjectList,
  storeRemove,
  storeSetWriteRoute,
  storeSwitchPersonal,
  storeSwitchWrite,
} from "../store/store-ops.js";
import { linkWorkspaceToStore, unlinkWorkspaceFromStore, listLinkedWorkspaces } from "./store-link.js";
import {
  STORE_LAYOUT,
  loadGlobalConfig,
  resolveGlobalRoot,
} from "@fenglimg/fabric-shared";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — `fabric store` command group (S57/E4/S7).
// Presentation-only shell over store-ops (which holds the testable logic).
// ---------------------------------------------------------------------------

// W3-C: confirm-before-mutate gate for destructive `store migrate *` ops. The
// safety lives in the CLI itself (not in skill prose) — mirrors doctor --fix
// consent + KT-PIT-0016 honesty: a preflight DRY run computes the real change
// count, we only prompt when something would actually mutate, and a non-TTY
// shell must opt in via --yes / FABRIC_NONINTERACTIVE=1 (never silently mutate).
async function resolveStoreMutationConsent(opts: {
  label: string;
  count: number;
  yes: boolean;
}): Promise<"proceed" | "abort"> {
  if (opts.yes || process.env.FABRIC_NONINTERACTIVE === "1") {
    return "proceed";
  }
  if (process.stdin.isTTY !== true) {
    console.error(
      `store ${opts.label}: stdin is not a TTY and neither --yes nor FABRIC_NONINTERACTIVE=1 is set. Refusing to mutate.`,
    );
    return "abort";
  }
  const answer = await confirm({
    message: `About to rewrite ${opts.count} knowledge entr${opts.count === 1 ? "y" : "ies"} (store ${opts.label}). Proceed?`,
    initialValue: false,
  });
  if (isCancel(answer) || answer !== true) {
    console.error(`store ${opts.label}: aborted by user.`);
    return "abort";
  }
  return "proceed";
}

// Run a destructive migrate op behind the consent gate: a DRY preflight counts
// real changes; 0 → print the no-op report and return (no prompt for a no-op);
// otherwise confirm, then apply for real. `--dry-run` short-circuits to preview.
async function runGatedMigrate<R extends { changes: readonly unknown[] }>(opts: {
  label: string;
  dryRun: boolean;
  yes: boolean;
  run: (dryRun: boolean) => Promise<R> | R;
  print: (report: R) => void;
}): Promise<void> {
  if (opts.dryRun) {
    opts.print(await opts.run(true));
    return;
  }
  const preview = await opts.run(true);
  if (preview.changes.length === 0) {
    opts.print(preview);
    return;
  }
  const decision = await resolveStoreMutationConsent({
    label: opts.label,
    count: preview.changes.length,
    yes: opts.yes,
  });
  if (decision === "abort") {
    process.exitCode = 1;
    return;
  }
  opts.print(await opts.run(false));
}

// flat-design: a store mutation's confirmation/error is a single status line —
// a leading ✓ (green) / ✗ (red) glyph + the localized message, the same
// status-message language install/uninstall use. Keeps colour on status only.
function okLine(msg: string): string {
  return `${symbol.ok} ${msg}`;
}
function errLine(msg: string): string {
  return `${symbol.error} ${paint.error(msg)}`;
}

const listCommand = defineCommand({
  meta: { name: "list", description: "List mounted knowledge stores" },
  run() {
    const t = getProjectTranslator();
    const stores = storeList();
    // flat-design (spec §0.4): a command-level B-横线 title over `● <name>` rows.
    // KT-PIT-0027: lead with the DESCRIPTIVE mount/git-repo name (a bare alias
    // like "team" can't tell two team-class stores apart); the short alias — the
    // thing you actually type in commands — sits in the second column. The status
    // glyph encodes remote-backing (✓ has a remote → sync can push / it's backed
    // up; ○ local-only → no remote, a real caveat), so colour carries status, not
    // decoration. The full uuid is machine detail — dropped here, available via
    // `store explain <alias>`.
    console.log("");
    console.log(headerRule(t("cli.store.list.title")));
    if (stores.length === 0) {
      console.log(`  ${paint.muted(t("cli.store.none-mounted"))}`);
      return;
    }
    const localOnly = t("cli.shared.local-only");
    // F14 (W2-T4): local-only reflects the store repo's TRUE git remote, not the
    // config metadata — a store whose config records a remote but whose repo has
    // no `origin` (personal store, or pre-F-SYNC-REMOTE) is honestly local-only.
    const rows = stores.map((store) => {
      const remote = storeGitRemote(store.alias);
      const name = store.mount_name ?? store.store_uuid;
      const glyph = remote ? paint.success("✓") : paint.warn("○");
      return [groupDot(name), store.alias, `${glyph} ${paint.muted(remote ?? localOnly)}`];
    });
    console.log(
      grid(rows, { gap: 3 })
        .split("\n")
        .map((line) => `  ${line}`.replace(/[ \t]+$/, ""))
        .join("\n"),
    );
  },
});

const mountCommand = defineCommand({
  // hidden: skill/CI/recovery-facing — kept callable, omitted from `store --help`.
  meta: { name: "mount", description: "Mount a knowledge store into the global registry", hidden: true },
  args: {
    uuid: { type: "string", required: true, description: "Intrinsic store UUID" },
    alias: { type: "string", required: true, description: "Local alias for this store" },
    "mount-name": { type: "string", description: "Stable local directory under ~/.fabric/stores/" },
    remote: { type: "string", description: "Git remote locator (omit for local-only)" },
  },
  async run({ args }) {
    // ADJ-NEWN-6: fail fast on a phantom mount (uuid with no on-disk tree)
    // instead of writing the registry entry and crashing later in `sync`.
    assertStoreMountable(args.uuid, undefined, args["mount-name"]);
    const store: MountedStore =
      args.remote === undefined
        ? {
            store_uuid: args.uuid,
            alias: args.alias,
            ...(args["mount-name"] === undefined ? {} : { mount_name: args["mount-name"] }),
          }
        : {
            store_uuid: args.uuid,
            alias: args.alias,
            ...(args["mount-name"] === undefined ? {} : { mount_name: args["mount-name"] }),
            remote: args.remote,
          };
    const next = storeAdd(store);
    const t = getProjectTranslator();
    console.log(
      okLine(
        t("cli.store.mounted", {
          alias: args.alias,
          count: String(next.stores.length),
        }),
      ),
    );
  },
});

const createCommand = defineCommand({
  meta: { name: "create", description: "Create a brand-new local knowledge store and mount it", hidden: true },
  args: {
    alias: { type: "string", required: true, description: "Local alias for the new store" },
    "mount-name": { type: "string", description: "Stable local directory under ~/.fabric/stores/" },
    remote: { type: "string", description: "Git remote to associate (push target; optional)" },
    personal: {
      type: "boolean",
      description: "Mint a personal store (personal:true) — adds another machine-wide personal identity",
    },
  },
  async run({ args }) {
    const result = await storeCreate(args.alias, new Date().toISOString(), {
      ...(args["mount-name"] === undefined ? {} : { mountName: args["mount-name"] }),
      ...(args.remote === undefined ? {} : { remote: args.remote }),
      ...(args.personal === true ? { personal: true } : {}),
    });
    const t = getProjectTranslator();
    console.log(
      okLine(t("cli.store.created", { alias: args.alias, uuid: result.store_uuid, dir: result.storeDir })),
    );
    if (args.remote === undefined) {
      // Rich detail folds onto a muted continuation line, not a wall-of-text suffix.
      console.log(`  ${paint.muted(t("cli.store.created-local-hint"))}`);
    }
  },
});

const removeCommand = defineCommand({
  meta: { name: "remove", description: "Detach a store from the registry (does NOT delete it)", hidden: true },
  args: {
    alias: { type: "positional", required: true, description: "Alias to detach" },
  },
  async run({ args }) {
    const { detached } = storeRemove(args.alias);
    const t = getProjectTranslator();
    if (detached === null) {
      process.exitCode = 1;
      console.log(errLine(t("cli.store.no-alias", { alias: args.alias })));
      return;
    }
    console.log(okLine(t("cli.store.detached", { alias: args.alias })));
  },
});

const explainCommand = defineCommand({
  meta: { name: "explain", description: "Explain how a store alias resolves", hidden: true },
  args: {
    alias: { type: "positional", required: true, description: "Alias to explain" },
  },
  run({ args }) {
    const explanation = storeExplain(args.alias);
    if (explanation === null) {
      process.exitCode = 1;
      console.log(errLine(getProjectTranslator()("cli.store.no-alias", { alias: args.alias })));
      return;
    }
    // explain is a machine-readable resolver dump — stays raw JSON.
    console.log(JSON.stringify(explanation, null, 2));
  },
});

const bindCommand = defineCommand({
  meta: { name: "bind", description: "Declare a required store on this project's config", hidden: true },
  args: {
    id: { type: "positional", required: true, description: "Store alias/UUID to require" },
    remote: { type: "string", description: "Suggested remote for clone onboarding" },
    project: {
      type: "string",
      description: "Bind this repo to a project:<id> in the store (must already exist)",
    },
  },
  async run({ args }) {
    const entry =
      args.remote === undefined ? { id: args.id } : { id: args.id, suggested_remote: args.remote };
    const projectRoot = process.cwd();
    const next = await storeBind(
      projectRoot,
      entry,
      args.project === undefined ? {} : { project: args.project },
    );
    console.log(
      okLine(
        getProjectTranslator(projectRoot)("cli.store.bound", {
          id: args.id,
          count: String(next.required_stores?.length ?? 0),
        }),
      ),
    );
    // Regenerate the resolved-bindings snapshot so P4 hooks read a consistent
    // read-set/write-target without re-resolving (P3→P4 chain, done_when).
    regenerateBindingsSnapshot(projectRoot, { now: new Date().toISOString() });
  },
});

// W3-E: `switch-write` owns BOTH write-target modes (the old `route-write` is
// folded in via `--scope`). Without `--scope` it sets the project's default
// write store (storeSwitchWrite → default_write_store); with `--scope <s>` it
// routes one semantic scope to a store (storeSetWriteRoute → write_routes[]).
// Both are config "where do writes go" mutations — siblings, one command.
const switchWriteCommand = defineCommand({
  meta: {
    name: "switch-write",
    description: "Set the default write store, or route one semantic scope with --scope",
    hidden: true,
  },
  args: {
    alias: { type: "positional", required: true, description: "Alias of the store to write to" },
    scope: {
      type: "string",
      description: "Route only this semantic scope (e.g. team or project:fabric-v2) to the store",
    },
  },
  async run({ args }) {
    const projectRoot = process.cwd();
    if (typeof args.scope === "string" && args.scope.length > 0) {
      storeSetWriteRoute(projectRoot, args.scope, args.alias);
      regenerateBindingsSnapshot(projectRoot, { now: new Date().toISOString() });
      console.log(
        okLine(
          getProjectTranslator(projectRoot)("cli.store.routed", {
            scope: args.scope,
            alias: args.alias,
          }),
        ),
      );
      return;
    }
    storeSwitchWrite(projectRoot, args.alias);
    regenerateBindingsSnapshot(projectRoot, { now: new Date().toISOString() });
    console.log(okLine(getProjectTranslator(projectRoot)("cli.store.switch-write", { alias: args.alias })));
  },
});

// 语义 A (multi-personal): `switch-personal` sets the machine-wide ACTIVE
// personal store among possibly-many mounted `personal:true` stores. Distinct
// from `switch-write` (which writes the PROJECT config for team scopes) — this
// writes the GLOBAL config's active_personal_store because personal is uid-scoped
// machine identity (KT-DEC-0020). Refuses a non-personal target.
const switchPersonalCommand = defineCommand({
  meta: {
    name: "switch-personal",
    description: "Set the active personal store for this machine (among mounted personal stores)",
    hidden: true,
  },
  args: {
    alias: { type: "positional", required: true, description: "Alias/UUID of the personal store" },
  },
  run({ args }) {
    storeSwitchPersonal(args.alias);
    console.log(okLine(getProjectTranslator()("cli.store.switch-personal", { alias: args.alias })));
  },
});

// W1/A2 — store-internal project registry. `store project list <alias>` /
// `store project create <alias> <id>` enumerate / register the projects a store
// serves (the `<id>` segments forming `project:<id>` coordinates).
const projectListCommand = defineCommand({
  meta: { name: "list", description: "List projects registered in a store" },
  args: {
    store: { type: "positional", required: true, description: "Store alias/UUID" },
  },
  async run({ args }) {
    const t = getProjectTranslator();
    const projects = await storeProjectList(args.store);
    console.log("");
    console.log(headerRule(t("cli.store.project.list.title", { store: args.store })));
    if (projects.length === 0) {
      console.log(`  ${paint.muted(t("cli.store.project.list.empty"))}`);
      return;
    }
    const rows = projects.map((p) => [groupDot(p.id), p.name === undefined ? "" : paint.muted(p.name)]);
    console.log(
      grid(rows, { gap: 3 })
        .split("\n")
        .map((line) => `  ${line}`.replace(/[ \t]+$/, ""))
        .join("\n"),
    );
  },
});

const projectCreateCommand = defineCommand({
  meta: { name: "create", description: "Register a new project in a store" },
  args: {
    store: { type: "positional", required: true, description: "Store alias/UUID" },
    id: { type: "positional", required: true, description: "Project id (single [a-z0-9_-] segment)" },
    name: { type: "string", description: "Optional human-facing label" },
  },
  async run({ args }) {
    const project = await storeProjectCreate(args.store, args.id, new Date().toISOString(), {
      ...(args.name === undefined ? {} : { name: args.name }),
    });
    console.log(
      okLine(getProjectTranslator()("cli.store.project.created", { id: project.id, store: args.store })),
    );
  },
});

const projectCommand = defineCommand({
  meta: { name: "project", description: "Manage the projects a store serves", hidden: true },
  subCommands: {
    list: projectListCommand,
    create: projectCreateCommand,
  },
});

// W3/A5 — clean-slate scope backfill. Adds semantic_scope + visibility_store to
// existing entries and repairs dirty layer. Store-only: targets an explicit
// mounted store via `--store <alias>`, or the project's active write store.
const backfillScopeCommand = defineCommand({
  meta: {
    name: "backfill",
    description: "Backfill semantic_scope + visibility_store on existing knowledge (repairs dirty layer)",
  },
  args: {
    store: { type: "string", description: "Backfill a mounted store's knowledge" },
    "dry-run": { type: "boolean", description: "Preview changes without writing" },
    yes: { type: "boolean", description: "Skip the confirm-before-mutate prompt (CI / non-interactive)" },
  },
  async run({ args }) {
    const dryRun = args["dry-run"] === true;
    let knowledgeDir: string;
    let visibilityStore: string;
    const selectedStore =
      typeof args.store === "string" && args.store.length > 0
        ? args.store
        : loadProjectConfig(process.cwd())?.active_write_store;
    if (typeof selectedStore !== "string" || selectedStore.length === 0) {
      console.error(
        "no store selected for scope backfill; pass --store <alias> or run `fabric store switch-write <alias>`",
      );
      process.exitCode = 1;
      return;
    }
    {
      const storeDir = resolveStoreDir(selectedStore);
      if (storeDir === null) {
        console.error(`no mounted store '${selectedStore}'`);
        process.exitCode = 1;
        return;
      }
      knowledgeDir = join(storeDir, STORE_LAYOUT.knowledgeDir);
      visibilityStore = selectedStore;
    }
    const t = getProjectTranslator();
    const printReport = (
      report: ReturnType<typeof backfillKnowledgeDir>,
      preview: boolean,
    ): void => {
      const prefix = preview ? "[dry-run] " : "";
      console.log("");
      console.log(headerRule(t("cli.store.migrate.title")));
      if (report.changes.length === 0) {
        console.log(`  ${paint.muted(t("cli.store.backfill.noop", { count: String(report.unchanged) }))}`);
        return;
      }
      console.log(
        `  ${prefix}${t("cli.store.backfill.summary", { changed: String(report.changes.length), unchanged: String(report.unchanged) })}`,
      );
      for (const c of report.changes) {
        console.log(`  ${groupDot(c.id ?? "(no id)")}  ${paint.muted(`[${c.changed.join(", ")}]`)}`);
      }
      // Guardrail: backfill defaults every team-layer entry to `semantic_scope:
      // team` — over-broad. Project-specific entries (incl. components reused
      // across gameplay WITHIN one app — NOT cross-project) must be demoted.
      const scopeAssigned = report.changes.filter((c) => c.changed.includes("semantic_scope")).length;
      if (scopeAssigned > 0) {
        console.error(
          `  ${symbol.warn} ${paint.warn(`${prefix}${t("cli.store.backfill.scope-note", { count: String(scopeAssigned) })}`)}`,
        );
      }
    };
    // W3-C confirm-before-mutate gate (preflight DRY counts real changes).
    if (dryRun) {
      printReport(backfillKnowledgeDir(knowledgeDir, { visibilityStore, dryRun: true }), true);
      return;
    }
    const preview = backfillKnowledgeDir(knowledgeDir, { visibilityStore, dryRun: true });
    if (preview.changes.length === 0) {
      printReport(preview, false);
      return;
    }
    const decision = await resolveStoreMutationConsent({
      label: "migrate backfill",
      count: preview.changes.length,
      yes: args.yes === true,
    });
    if (decision === "abort") {
      process.exitCode = 1;
      return;
    }
    printReport(backfillKnowledgeDir(knowledgeDir, { visibilityStore, dryRun: false }), false);
  },
});

// W4/A7 — re-scope + promote. Resolve a mounted store's dir + visibility (the
// `personal` flag drives the R5#3 refusal inside rescopeStore).
function resolveStoreDirAndVisibility(
  aliasOrUuid: string,
): { dir: string; visibility: "shared" | "personal" } | null {
  const dir = resolveStoreDir(aliasOrUuid);
  if (dir === null) {
    return null;
  }
  const store = loadGlobalConfig(resolveGlobalRoot())?.stores.find(
    (s) => s.alias === aliasOrUuid || s.store_uuid === aliasOrUuid,
  );
  return { dir, visibility: store?.personal === true ? "personal" : "shared" };
}

function printRescopeReport(report: RescopeReport): void {
  // flat-design (light, spec §0.4): a B-横线 migration title + `● <id>` change
  // rows; the `[dry-run]` marker stays inline. Cold power-user tool, so structure
  // over chrome. Refusals stay on stderr with a ✗ glyph.
  const t = getProjectTranslator();
  const prefix = report.dryRun ? "[dry-run] " : "";
  console.log("");
  console.log(headerRule(t("cli.store.migrate.title")));
  if (report.changes.length === 0 && report.refusals.length === 0) {
    console.log(`  ${paint.muted(t("cli.store.rescope.noop", { count: String(report.unchanged), scope: report.toScope }))}`);
  } else if (report.changes.length > 0) {
    console.log(
      `  ${prefix}${t("cli.store.rescope.summary", { scope: report.toScope, changed: String(report.changes.length), unchanged: String(report.unchanged) })}`,
    );
    for (const c of report.changes) {
      console.log(`  ${groupDot(c.id ?? "(no id)")}  ${paint.muted(`${c.fromScope ?? "(none)"} → ${c.toScope}`)}`);
    }
  }
  if (report.refusals.length > 0) {
    console.error(`  ${symbol.error} ${paint.error(t("cli.store.rescope.refused", { count: String(report.refusals.length) }))}`);
    for (const r of report.refusals) {
      console.error(`  ${groupDot(r.id ?? "(no id)")}  ${paint.error(r.reason)}`);
    }
    process.exitCode = 1;
  }
}

const rescopeCommand = defineCommand({
  meta: {
    name: "scope",
    description: "Rewrite knowledge entries' semantic_scope coordinate in a store",
  },
  args: {
    store: { type: "positional", required: true, description: "Target store alias or uuid" },
    to: { type: "string", required: true, description: "New semantic_scope (e.g. team, project:alpha)" },
    id: { type: "string", description: "Only the entry with this stable_id" },
    from: { type: "string", description: "Only entries currently at this semantic_scope" },
    "dry-run": { type: "boolean", description: "Preview changes without writing" },
    yes: { type: "boolean", description: "Skip the confirm-before-mutate prompt (CI / non-interactive)" },
  },
  async run({ args }) {
    const resolved = resolveStoreDirAndVisibility(args.store);
    if (resolved === null) {
      console.error(`no mounted store '${args.store}'`);
      process.exitCode = 1;
      return;
    }
    await runGatedMigrate({
      label: "migrate scope",
      dryRun: args["dry-run"] === true,
      yes: args.yes === true,
      run: (dryRun) =>
        rescopeStore(resolved.dir, args.to, {
          id: args.id,
          fromScope: args.from,
          storeVisibility: resolved.visibility,
          dryRun,
        }),
      print: printRescopeReport,
    });
  },
});

const promoteCommand = defineCommand({
  meta: {
    name: "promote",
    description: "Promote project-scoped entries to team scope (project absorption)",
  },
  args: {
    store: { type: "positional", required: true, description: "Target store alias or uuid" },
    project: { type: "string", description: "Only this project's entries (default: all project:*)" },
    "dry-run": { type: "boolean", description: "Preview changes without writing" },
    yes: { type: "boolean", description: "Skip the confirm-before-mutate prompt (CI / non-interactive)" },
  },
  async run({ args }) {
    const resolved = resolveStoreDirAndVisibility(args.store);
    if (resolved === null) {
      console.error(`no mounted store '${args.store}'`);
      process.exitCode = 1;
      return;
    }
    await runGatedMigrate({
      label: "migrate promote",
      dryRun: args["dry-run"] === true,
      yes: args.yes === true,
      run: (dryRun) =>
        promoteProjectToTeam(resolved.dir, {
          projectId: args.project,
          storeVisibility: resolved.visibility,
          dryRun,
        }),
      print: printRescopeReport,
    });
  },
});

// W3-E: knowledge-coordinate migration ops grouped under `store migrate <sub>`.
// All three REWRITE on-disk knowledge entries' scope coordinates (scope = the
// old `re-scope`, promote = project→team absorption, backfill = fill missing
// semantic_scope/visibility) — distinct from the config-only write-routing of
// `switch-write`. Grouping keeps the migrate surface semantically pure.
const migrateCommand = defineCommand({
  meta: { name: "migrate", description: "Rewrite knowledge entries' scope coordinates in a store", hidden: true },
  subCommands: {
    scope: rescopeCommand,
    promote: promoteCommand,
    backfill: backfillScopeCommand,
  },
});

// BORROW-010: workspace linking — `fabric store link <alias> [workspace]`.
// Links a workspace directory to a store for discoverability.
const linkCommand = defineCommand({
  meta: {
    name: "link",
    description: "Link a workspace directory to a store for discoverability",
  },
  args: {
    store: {
      type: "positional",
      description: "Store alias (e.g. 'team')",
      required: true,
    },
    workspace: {
      type: "positional",
      description: "Workspace directory path (default: current dir)",
      required: false,
    },
    unlink: {
      type: "boolean",
      alias: "u",
      description: "Remove the link instead of creating it",
      required: false,
    },
    list: {
      type: "boolean",
      alias: "l",
      description: "List linked workspaces for the store",
      required: false,
    },
  },
  async run(context) {
    const t = getProjectTranslator();
    const args = context.args;

    if (args.list) {
      const workspaces = listLinkedWorkspaces(args.store);
      if (workspaces.length === 0) {
        console.log(t("store.link.list.empty", { alias: args.store }));
      } else {
        console.log(t("store.link.list.header", { alias: args.store }));
        for (const ws of workspaces) {
          console.log(`  ${ws}`);
        }
      }
      return;
    }

    const workspacePath = args.workspace ?? process.cwd();

    if (args.unlink) {
      unlinkWorkspaceFromStore(args.store, workspacePath);
      console.log(t("store.link.unlinked", {
        store: args.store,
        workspace: workspacePath,
      }));
      return;
    }

    try {
      const info = linkWorkspaceToStore(args.store, workspacePath);
      console.log(t("store.link.created", {
        store: info.storeAlias,
        uuid: info.storeUuid,
        workspace: info.workspacePath,
      }));
    } catch (error) {
      console.error(t("store.link.failed", {
        store: args.store,
        workspace: workspacePath,
        error: error instanceof Error ? error.message : String(error),
      }));
      process.exit(1);
    }
  },
});

export default defineCommand({
  meta: { name: "store", description: t("cli.store.description") },
  // W3-E: subCommands ordered by value axis — registry (which stores exist) →
  // project wiring (where this repo reads/writes) → knowledge migration →
  // store-internal project registry.
  subCommands: {
    // registry
    mount: mountCommand,
    list: listCommand,
    create: createCommand,
    remove: removeCommand,
    explain: explainCommand,
    // project wiring
    bind: bindCommand,
    "switch-write": switchWriteCommand,
    "switch-personal": switchPersonalCommand,
    // knowledge migration
    migrate: migrateCommand,
    // store-internal projects
    project: projectCommand,
  },
});
