// ---------------------------------------------------------------------------
// `GET /api/integrations` — what Fabric actually installed into this project,
// and which of its runtime behaviours are in force.
//
// EVERY row here is computed by looking at the filesystem. There is no list of
// booleans saying which artifacts are installed, and adding one would be the
// KT-PIT-0067 defect verbatim: install spec, uninstall spec, and the tree on
// disk make three answers, two of them hand-copied. The page's whole value is
// being the one that reads the tree.
//
// The comparison is `installed bytes === template bytes`, decided as utf8
// strings because that is exactly what `copyTextIdempotent` compares before
// deciding to write. Anything else would let the page call a file drifted that
// `fabric install` considers up to date.
//
// It subsumes both drift stories in one read: a file edited after install and a
// file left behind by an OLDER CLI both differ from the template this CLI ships.
// `.fabric/install-manifest.json` still rides along, but only for the one thing
// bytes cannot tell you — which version wrote them.
// ---------------------------------------------------------------------------

import { readFile, readdir } from "node:fs/promises";
import { dirname, join, posix, relative, sep } from "node:path";

import {
  HOOK_REGISTRATIONS,
  getPanelFields,
  isHookRegistered,
  matchBootstrapCanonicalLocale,
  resolveBootstrapCanonical,
  type HookClient,
} from "@fenglimg/fabric-shared";
import { BOOTSTRAP_REGEX } from "@fenglimg/fabric-shared/templates/bootstrap-canonical";
import { inspectInstallCopyDrift, type InstallDriftStatus } from "@fenglimg/fabric-server";

import { t } from "../i18n.js";
import { buildManagedBlockBody } from "../install/bootstrap-propagation.js";
import {
  FABRIC_SKILL_INSTALL_SPECS,
  HOOK_LIB_DESTINATIONS,
  HOOK_LIB_TEMPLATE_DIR_REL,
  HOOK_SCRIPT_DESTINATIONS,
  SKILL_LIB_DESTINATIONS,
} from "../install/distribution-targets.js";
import { findTemplatePath } from "../install/template-io.js";
import { loadGlobalConfig, resolveGlobalRoot } from "../store/global-config-io.js";
import { asPlainObject, buildPanelContext } from "./config-resolve.js";
import { viewOf, type FieldView } from "./global-config-view.js";
import { BEHAVIORS } from "./integrations-registry.js";
import type { ResolvedScope } from "./scope.js";

/** What the tree says about one file Fabric is supposed to own. */
export type ArtifactState =
  /** Present and byte-identical to the template this CLI ships. */
  | "ok"
  /** Not there at all. */
  | "missing"
  /** Present but different — hand-edited, or written by an older CLI. */
  | "modified"
  /**
   * Present in the destination with no template behind it. Install never
   * prunes, so a companion file dropped from a later release stays forever and
   * keeps being read by the client that finds it.
   */
  | "orphan";

export interface ArtifactFile {
  /** Project-root-relative, POSIX-shaped so it reads the same on every OS. */
  path: string;
  state: ArtifactState;
}

export interface ArtifactGroup {
  /** Skill slug, or the hook script's basename. Stable across renames of the label. */
  id: string;
  /** The file a reader would go open — the SKILL.md, the .cjs, the lib directory. */
  path: string;
  /** Worst state among {@link files}; `ok` only when every file is `ok`. */
  state: ArtifactState;
  fileCount: number;
  /** ONLY the files that are not `ok`. A healthy group ships an empty array. */
  problems: ArtifactFile[];
}

/**
 * Whether this client can reach the Fabric MCP server.
 *
 * `path` is the file that carries (or would carry) the entry — a path, never
 * its contents: the same rule the config page's remote-embedding card follows,
 * since a client config can hold credentials for other tools entirely.
 */
export interface McpEntryView {
  connected: boolean;
  path: string | null;
  /** Which of the client's config locations holds it. */
  location: "project" | "user" | null;
}

export interface BootstrapView {
  /**
   * `missing` — the client is not pointed at Fabric's bootstrap at all.
   * `modified` — it is, but the block/snapshot no longer matches what install
   * would write, so the agent is reading stale rules.
   */
  state: "ok" | "missing" | "modified";
  path: string;
}

export interface ClientIntegration {
  id: HookClient;
  name: string;
  mcp: McpEntryView;
  bootstrap: BootstrapView;
  hooks: ArtifactGroup[];
  skills: ArtifactGroup[];
  /** The shared `.cjs` / `.md` helpers, one group per destination directory. */
  libs: ArtifactGroup[];
  /** How many groups across all three lists are not `ok`. */
  problems: number;
}

/**
 * A capability the user can judge — "reminds me to archive when I stop" — with
 * the file that implements it and the keys that tune it.
 *
 * The unit is the hook SCRIPT rather than the config key on purpose. A key is
 * something a page can render whether or not anything reads it; a script is
 * either on disk and registered or it is not. Keys hang off the script they
 * tune, so a knob can only appear next to a behaviour that exists.
 */
export interface BehaviorView {
  /** The hook script's basename without `.cjs`. */
  id: string;
  label: string;
  description: string;
  /** Client events it runs on, from the registration table. */
  events: string[];
  /** Per client: is the file installed, and is it wired into the hook config. */
  presence: { client: HookClient; file: ArtifactState; registered: boolean }[];
  /**
   * True when at least one client both has the file and has it registered.
   * A file nobody registered never runs, which is the case a per-file drift
   * list cannot show on its own.
   */
  active: boolean;
  /** The config keys that tune it, resolved exactly as the settings page does. */
  keys: FieldView[];
  /**
   * Keys this behaviour also reads, but whose control is rendered under an
   * EARLIER behaviour.
   *
   * `nudge_mode` and `hint_dismiss_signals` are read by three hooks apiece. Drawn
   * once per reader they became three live controls over one value: save one and
   * the other two keep displaying what the key used to be, so the page
   * contradicts itself until you reload. One control per key makes that
   * unrepresentable. The cross-reference stays because "which hooks does this
   * knob affect" is the question the grouping exists to answer — dropping the
   * mention would trade a stale value for a wrong one.
   */
  shared: { key: string; label: string; owner: string }[];
}

export interface IntegrationsView {
  scope: { kind: "machine" | "project"; projectId: string | null; path: string | null };
  /**
   * Where a knob edited on this page is written.
   *
   * Named by the server rather than assembled in the browser, because it has to
   * match the layer the values were RESOLVED at — a page that displays a
   * project's resolution and saves machine-wide would silently move a setting
   * one layer up. A directory with no `project_id` resolves at the machine
   * layer, so that is also where it writes.
   */
  writeTarget: { scope: "machine" } | { scope: "project"; projectId: string };
  clients: ClientIntegration[];
  behaviors: BehaviorView[];
  /** The one fact bytes cannot carry: which CLI version wrote this install. */
  manifest: {
    status: InstallDriftStatus;
    fabricVersion: string | null;
    tracked: number;
    driftCount: number;
  };
  strings: Record<string, string>;
}

const CLIENT_LABELS: Record<HookClient, string> = {
  claudeCode: "Claude Code",
  codex: "Codex CLI",
};

/** The literal key both client writers use for Fabric's MCP entry. */
const MCP_SERVER_NAME = "fabric";

function toPosix(path: string): string {
  return path.split(sep).join(posix.sep);
}

/** utf8 or `null` when the file is absent — an unreadable file reads as absent. */
async function readTextOrNull(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, "utf8");
  } catch {
    return null;
  }
}

async function namesIn(absDir: string, ext: string): Promise<string[]> {
  try {
    return (await readdir(absDir)).filter((name) => name.endsWith(ext)).sort();
  } catch {
    return [];
  }
}

/**
 * One destination file against the template that would produce it.
 *
 * `templateRel === null` means no template ships this path any more, which is
 * how an orphan is detected: it exists on disk and nothing would put it there.
 */
async function compareFile(
  projectRoot: string,
  destRel: string,
  templateRel: string | null,
): Promise<ArtifactFile> {
  const path = toPosix(destRel);
  const installed = await readTextOrNull(join(projectRoot, ...destRel.split("/")));
  if (templateRel === null) {
    return { path, state: installed === null ? "missing" : "orphan" };
  }
  if (installed === null) return { path, state: "missing" };
  const template = await readTextOrNull(findTemplatePathOrNull(templateRel) ?? "");
  // A template this CLI cannot resolve is a packaging fault, not a user's
  // problem — report the installed file as unjudgeable rather than accusing it
  // of drift. `orphan` is the honest label: nothing ships this path.
  if (template === null) return { path, state: "orphan" };
  return { path, state: installed === template ? "ok" : "modified" };
}

function findTemplatePathOrNull(relativePath: string): string | null {
  try {
    return findTemplatePath(relativePath);
  } catch {
    return null;
  }
}

const STATE_RANK: Record<ArtifactState, number> = { ok: 0, orphan: 1, modified: 2, missing: 3 };

function rollUp(id: string, path: string, files: ArtifactFile[]): ArtifactGroup {
  const problems = files.filter((f) => f.state !== "ok");
  const state = problems.reduce<ArtifactState>(
    (worst, f) => (STATE_RANK[f.state] > STATE_RANK[worst] ? f.state : worst),
    "ok",
  );
  return { id, path: toPosix(path), state, fileCount: files.length, problems };
}

// ---------------------------------------------------------------------------
// Skills — SKILL.md plus whatever `ref/*.md` companions ship beside it. The
// expected companion set comes from the TEMPLATE directory, so a ref file added
// upstream shows as missing here without anyone updating a list, and one
// dropped upstream shows as an orphan (install never prunes: KT-PIT-0079 is the
// same drift one level down, where a stale ref keeps teaching a retired rule).
// ---------------------------------------------------------------------------
async function skillGroups(projectRoot: string, clientDir: string): Promise<ArtifactGroup[]> {
  const groups: ArtifactGroup[] = [];
  for (const spec of Object.values(FABRIC_SKILL_INSTALL_SPECS)) {
    const destRel = spec.destinations.find((d) => d.startsWith(`${clientDir}/`));
    if (destRel === undefined) continue;
    const files: ArtifactFile[] = [await compareFile(projectRoot, destRel, spec.templateRel)];

    const templateRefDir = `${dirname(spec.templateRel)}/ref`;
    const templateRefs = new Set(
      await namesIn(findTemplatePathOrNull(templateRefDir) ?? "", ".md"),
    );
    const installedRefs = await namesIn(
      join(projectRoot, ...`${dirname(destRel)}/ref`.split("/")),
      ".md",
    );
    for (const name of new Set([...templateRefs, ...installedRefs])) {
      files.push(
        await compareFile(
          projectRoot,
          `${dirname(destRel)}/ref/${name}`,
          templateRefs.has(name) ? `${templateRefDir}/${name}` : null,
        ),
      );
    }
    groups.push(rollUp(spec.slug, destRel, files));
  }
  return groups;
}

async function hookGroups(projectRoot: string, clientDir: string): Promise<ArtifactGroup[]> {
  const groups: ArtifactGroup[] = [];
  for (const destinations of Object.values(HOOK_SCRIPT_DESTINATIONS)) {
    const destRel = destinations.find((d) => d.startsWith(`${clientDir}/`));
    if (destRel === undefined) continue;
    const basename = destRel.slice(destRel.lastIndexOf("/") + 1);
    groups.push(
      rollUp(basename, destRel, [
        await compareFile(projectRoot, destRel, `hooks/${basename}`),
      ]),
    );
  }
  return groups;
}

/**
 * The two shared-helper directories, each compared as a set: template contents
 * decide what should be there, the destination decides what is.
 */
async function libGroups(projectRoot: string, clientDir: string): Promise<ArtifactGroup[]> {
  const dirs: { destRel: string; templateRel: string; ext: string }[] = [];
  const hookLib = HOOK_LIB_DESTINATIONS.find((d) => d.startsWith(`${clientDir}/`));
  if (hookLib !== undefined) {
    dirs.push({ destRel: hookLib, templateRel: HOOK_LIB_TEMPLATE_DIR_REL, ext: ".cjs" });
  }
  const skillLib = SKILL_LIB_DESTINATIONS.find((d) => d.startsWith(`${clientDir}/`));
  if (skillLib !== undefined) {
    dirs.push({ destRel: skillLib, templateRel: "skills/lib", ext: ".md" });
  }

  const groups: ArtifactGroup[] = [];
  for (const dir of dirs) {
    const templateNames = new Set(
      await namesIn(findTemplatePathOrNull(dir.templateRel) ?? "", dir.ext),
    );
    const installedNames = await namesIn(
      join(projectRoot, ...dir.destRel.split("/")),
      dir.ext,
    );
    const files: ArtifactFile[] = [];
    for (const name of new Set([...templateNames, ...installedNames])) {
      files.push(
        await compareFile(
          projectRoot,
          `${dir.destRel}/${name}`,
          templateNames.has(name) ? `${dir.templateRel}/${name}` : null,
        ),
      );
    }
    groups.push(rollUp(dir.destRel, dir.destRel, files));
  }
  return groups;
}

// ---------------------------------------------------------------------------
// MCP — is this client pointed at the Fabric server.
//
// The two locations are read directly rather than through the writers'
// `detect()`, which gates on "does this client look installed" and would report
// a client with a live entry as having no config path at all. Presence of the
// entry is the question; where it lives is the answer's detail.
// ---------------------------------------------------------------------------
async function readMcpEntry(projectRoot: string, client: HookClient): Promise<McpEntryView> {
  if (client === "claudeCode") {
    const projectPath = join(projectRoot, ".mcp.json");
    const projectRaw = await readTextOrNull(projectPath);
    if (projectRaw !== null && hasJsonMcpEntry(projectRaw)) {
      return { connected: true, path: toPosix(relative(projectRoot, projectPath)), location: "project" };
    }
    const userPath = join(homeDir(), ".claude.json");
    const userRaw = await readTextOrNull(userPath);
    if (userRaw !== null && hasJsonMcpEntry(userRaw)) {
      return { connected: true, path: userPath, location: "user" };
    }
    return { connected: false, path: toPosix(relative(projectRoot, projectPath)), location: null };
  }

  // Codex keeps one machine-wide config; there is no project-scoped location.
  const tomlPath = join(homeDir(), ".codex", "config.toml");
  const raw = await readTextOrNull(tomlPath);
  const connected = raw !== null && new RegExp(String.raw`^\s*\[mcp_servers\.${MCP_SERVER_NAME}\]`, "mu").test(raw);
  return { connected, path: tomlPath, location: connected ? "user" : null };
}

function hasJsonMcpEntry(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const servers = asPlainObject(asPlainObject(parsed).mcpServers);
    return servers[MCP_SERVER_NAME] !== undefined;
  } catch {
    return false;
  }
}

function homeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? "";
}

// ---------------------------------------------------------------------------
// Bootstrap — is the client reading Fabric's rules, and are they current.
//
// The two clients consume it differently (KT-DEC-0012 keeps one source behind
// both), so the check differs too: Claude Code resolves an `@`-import at
// runtime, so the question is only whether the line is there; Codex carries a
// byte copy in a managed block, so the copy itself can go stale.
// ---------------------------------------------------------------------------
async function readBootstrap(projectRoot: string, client: HookClient): Promise<BootstrapView> {
  if (client === "claudeCode") {
    const path = "CLAUDE.md";
    const raw = await readTextOrNull(join(projectRoot, path));
    if (raw === null) return { state: "missing", path };
    const imported = raw
      .split(/\r?\n/u)
      .some((line) => line.replace(/\s+$/u, "") === "@.fabric/AGENTS.md");
    if (!imported) return { state: "missing", path };
    // The import resolves to `.fabric/AGENTS.md`, so THAT file's freshness is
    // what the agent actually reads. A locale switch rewrites it wholesale and
    // is not drift, which is why any locale's canonical body counts as current.
    const snapshot = await readTextOrNull(join(projectRoot, ".fabric", "AGENTS.md"));
    if (snapshot === null) return { state: "missing", path };
    const current =
      snapshot === resolveBootstrapCanonical() || matchBootstrapCanonicalLocale(snapshot) !== null;
    return { state: current ? "ok" : "modified", path };
  }

  const path = "AGENTS.md";
  const raw = await readTextOrNull(join(projectRoot, path));
  if (raw === null) return { state: "missing", path };
  const match = BOOTSTRAP_REGEX.exec(raw);
  if (match === null) return { state: "missing", path };
  let expected: string;
  try {
    expected = buildManagedBlockBody(projectRoot);
  } catch {
    // No `.fabric/AGENTS.md` to build from — the block exists but nothing on
    // this machine can say what it should contain.
    return { state: "modified", path };
  }
  return { state: match[0].includes(expected) ? "ok" : "modified", path };
}

// ---------------------------------------------------------------------------

async function collectClient(projectRoot: string, client: HookClient): Promise<ClientIntegration> {
  const clientDir = HOOK_REGISTRATIONS[client].clientDir;
  const [mcp, bootstrap, hooks, skills, libs] = await Promise.all([
    readMcpEntry(projectRoot, client),
    readBootstrap(projectRoot, client),
    hookGroups(projectRoot, clientDir),
    skillGroups(projectRoot, clientDir),
    libGroups(projectRoot, clientDir),
  ]);
  return {
    id: client,
    name: CLIENT_LABELS[client],
    mcp,
    bootstrap,
    hooks,
    skills,
    libs,
    problems: [...hooks, ...skills, ...libs].filter((g) => g.state !== "ok").length,
  };
}

async function readHookConfig(projectRoot: string, client: HookClient): Promise<unknown> {
  const raw = await readTextOrNull(
    join(projectRoot, ...HOOK_REGISTRATIONS[client].configFile.split("/")),
  );
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function collectBehaviors(
  projectRoot: string,
  clients: ClientIntegration[],
  projectId: string | null,
): Promise<BehaviorView[]> {
  const global = asPlainObject(loadGlobalConfig(resolveGlobalRoot()));
  // applyEnv:false for the same reason the settings page uses it: this
  // describes what a hook launched by the client resolves, not what the
  // console's own shell happens to export.
  const ctx = buildPanelContext({ projectId, storeRoot: null, applyEnv: false, global });
  const fields = getPanelFields();

  const configs = new Map<HookClient, unknown>();
  for (const client of clients) {
    configs.set(client.id, await readHookConfig(projectRoot, client.id));
  }

  // First behaviour to claim a key owns its control; later readers get a
  // cross-reference. Order is the registry's, which is the order the page
  // renders in, so "owner" is always ABOVE the mention that points at it.
  const owners = new Map<string, string>();

  return BEHAVIORS.map((behavior) => {
    const file = `${behavior.id}.cjs`;
    const presence = clients.map((client) => ({
      client: client.id,
      file: client.hooks.find((g) => g.id === file)?.state ?? ("missing" as ArtifactState),
      registered: isHookRegistered(configs.get(client.id), client.id, file),
    }));
    const label = t(`cli.console.behavior.${behavior.id}.label`);
    const own: FieldView[] = [];
    const shared: BehaviorView["shared"] = [];
    for (const key of behavior.keys) {
      const field = fields.find((f) => String(f.key) === key);
      if (field === undefined) continue;
      const owner = owners.get(key);
      if (owner === undefined) {
        owners.set(key, label);
        own.push(viewOf(field, ctx));
      } else {
        shared.push({ key, label: t(field.label_i18n_key), owner });
      }
    }

    return {
      id: behavior.id,
      label,
      description: t(`cli.console.behavior.${behavior.id}.description`),
      events: [
        ...new Set(
          Object.values(HOOK_REGISTRATIONS).flatMap((layout) =>
            layout.registrations.filter((r) => r.hookFile === file).map((r) => r.event),
          ),
        ),
      ],
      presence,
      active: presence.some((p) => p.file !== "missing" && p.registered),
      keys: own,
      shared,
    };
  });
}

function chromeStrings(): Record<string, string> {
  const keys = [
    "title",
    "intro",
    "machine-only",
    "machine-only-hint",
    "mcp.title",
    "mcp.on",
    "mcp.off",
    "mcp.off-hint",
    "mcp.location.project",
    "mcp.location.user",
    "bootstrap.title",
    "bootstrap.ok",
    "bootstrap.missing",
    "bootstrap.modified",
    "files.title",
    "files.hooks",
    "files.skills",
    "files.libs",
    "files.ok",
    "files.count",
    "files.readonly",
    "state.missing",
    "state.modified",
    "state.orphan",
    "behaviors.title",
    "behaviors.intro",
    "behaviors.active",
    "behaviors.inactive",
    "behaviors.unregistered",
    "behaviors.file-missing",
    "behaviors.tuned-by",
    "behaviors.no-keys",
    "behaviors.shared",
    "repair.title",
    "repair.intro",
    "repair.install",
    "repair.install-hint",
    "repair.doctor",
    "repair.doctor-hint",
    "repair.running",
    "repair.done",
    "manifest.title",
    "manifest.ok",
    "manifest.no-manifest",
    "manifest.unreadable",
    "manifest.drifted",
    "manifest.version",
    "problems.none",
    "problems.count",
    "loading",
    "load-failed",
  ] as const;
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = t(`cli.console.integrations.${key}`);
  // The behaviour rows render the SAME control the settings page renders
  // (shell.js `FabricField.control`), so they need that control's copy. Taken
  // from the settings namespace rather than duplicated into this one: two
  // strings for one button is two things to translate and one of them to get
  // out of step with what the button actually does.
  for (const key of ["save", "saved", "save-failed", "reset", "reset-done", "env-locked"]) {
    out[key] = t(`cli.console.config.${key}`);
  }
  return out;
}

/**
 * @param scope the request's resolved scope. Machine scope returns no clients
 * and no behaviours: both are properties of a project directory, and inventing
 * a machine-wide roll-up would answer a question ("is Fabric installed") that
 * has no machine-wide answer.
 */
export async function collectIntegrations(scope: ResolvedScope): Promise<IntegrationsView> {
  const strings = chromeStrings();
  if (scope.kind === "machine") {
    return {
      scope: { kind: "machine", projectId: null, path: null },
      writeTarget: { scope: "machine" },
      clients: [],
      behaviors: [],
      manifest: { status: "no-manifest", fabricVersion: null, tracked: 0, driftCount: 0 },
      strings,
    };
  }

  const projectRoot = scope.projectRoot;
  const clients = await Promise.all(
    (Object.keys(HOOK_REGISTRATIONS) as HookClient[]).map((client) =>
      collectClient(projectRoot, client),
    ),
  );
  // The same inspector `fabric doctor` reports install_copy_drift from. A
  // second implementation would eventually disagree with the command users are
  // told to run when this page says something is wrong.
  const drift = await inspectInstallCopyDrift(projectRoot);

  return {
    scope: { kind: "project", projectId: scope.projectId, path: projectRoot },
    writeTarget:
      scope.projectId === null
        ? { scope: "machine" }
        : { scope: "project", projectId: scope.projectId },
    clients,
    behaviors: await collectBehaviors(projectRoot, clients, scope.projectId),
    manifest: {
      status: drift.status,
      fabricVersion: drift.fabricVersion,
      tracked: drift.tracked,
      driftCount: drift.drifts.length,
    },
    strings,
  };
}
