// ---------------------------------------------------------------------------
// `GET /api/config` — how THIS MACHINE is configured.
//
// The predecessor of this module answered the same question about one
// directory: it read `project_id` out of the repo you happened to launch from,
// and everything you could see or change followed from that. But configuration
// does not live in a repo — it lives in `~/.fabric/fabric-global.json`. The
// working directory is a fact about how you started a server, and letting it
// decide what the page contains meant the same machine gave two different
// answers depending on where you stood.
//
// So the axis here is the machine, in three sections:
//
//   machine    the defaults every project inherits           (18 keys)
//   projects   the exceptions individual projects carry      (0 on a fresh machine)
//   stores     properties of each mounted knowledge base     (1 key × N stores)
//
// Assembly only, same rule as before: every value comes from `resolveEffective`,
// the function `fabric config` uses. Targeting a different project or store is
// expressed by building a different PanelContext, never by re-deriving an
// answer here — a second producer is a second thing that can disagree.
// ---------------------------------------------------------------------------

import {
  getPanelFields,
  envOverrideFor,
  storeRelativePathForMount,
  type PanelFieldMeta,
} from "@fenglimg/fabric-shared";
import { join } from "node:path";

import { t } from "../i18n.js";
import { globalConfigPath, loadGlobalConfig, resolveGlobalRoot } from "../store/global-config-io.js";
// The same probe `fabric info recall` reports from. Two implementations of
// "is the vector channel actually up" would eventually disagree, and the one a
// user is looking at would be the wrong one.
import { gatherRecallStatus } from "../commands/info.js";
import { listRegisteredProjects } from "../store/project-registry-io.js";
import {
  asPlainObject,
  buildPanelContext,
  loadPanelContext,
  resolveEffective,
  type PanelContext,
  type ValueSource,
} from "./config-resolve.js";
import {
  ARCHIVE_PRESETS,
  ARCHIVE_PRESET_KEYS,
  matchArchivePreset,
  SEMANTIC_SEARCH_KEY,
  tierOf,
  type FieldTier,
} from "./config-presentation.js";
import { collectKnownProjects, type MergedProject } from "./project-list.js";

export interface FieldView {
  key: string;
  group: string;
  home: "global_root" | "preference" | "corpus";
  label: string;
  description: string;
  type: "boolean" | "number" | "string" | "string[]";
  widget: "select" | "text" | "multiselect";
  enumValues?: readonly string[];
  /**
   * Rendered through the field's own `format_for_display`. A `multiselect` field
   * arrives here comma-joined — the same wire form its `validate` accepts — so a
   * value survives the page round-trip without the transport needing to know
   * which keys are sets.
   */
  effective: string;
  source: ValueSource;
  sourceLabel: string;
  /** Front page or behind "advanced". Unknown keys land in advanced, never nowhere. */
  tier: FieldTier;
  /**
   * THIS layer holds a value for this key — the layer the surrounding context
   * targets, which is also the one a write from this row would land in.
   *
   * Derived from the resolved SOURCE rather than by comparing the value to the
   * default: a key explicitly set to the same value the default would have
   * produced is still a pinned decision that outranks every layer below it, and
   * hiding that would make "why does my machine-wide setting not reach this
   * project" unanswerable from the page.
   *
   * The predicate used to be `source !== "default"`, which is a different
   * question — "is anyone anywhere overriding the built-in" — and answers yes
   * for a value merely INHERITED from a higher layer. It drives two things that
   * both need the narrow reading: the "set here, no longer follows the layer
   * below" marker, which was simply false on an inherited row, and the reset
   * button, which on such a row removes nothing and reports success anyway.
   * @see layerOf
   */
  modified: boolean;
  /**
   * Some OTHER layer decided this value. Mutually exclusive with `modified`;
   * both false means the built-in default is deciding and nobody has an opinion.
   *
   * `source` says which layer, and `sourceLabel` names it in the user's
   * language — so a row can state where its value actually came from instead of
   * leaving the reader to guess whether silence means "default" or "inherited".
   * An env-decided value counts as inherited (the environment is another layer);
   * a page that renders the env lock separately can branch on `source`.
   */
  inherited: boolean;
  /** The variable that can override this key, or null when none reads one. */
  envVar: string | null;
  /**
   * False only when an environment variable is DECIDING this value — which this
   * module claims exclusively for the launch directory's own project. See
   * {@link PanelContext.applyEnv}: for any other row the console cannot observe
   * the environment of the process that would read the variable, so it reports
   * `envVar` as a possibility and leaves the field editable.
   */
  editable: boolean;
}

interface ProjectView extends MergedProject {
  /** Only the keys this project actually overrides — usually none. */
  overrides: FieldView[];
}

interface StoreView {
  storeUuid: string;
  alias: string;
  personal: boolean;
  fields: FieldView[];
}

/**
 * Remote embedding, reported as SHAPE not CONTENT.
 *
 * `~/.fabric/fabric-global.json` really does hold a plaintext API key. Rendering
 * it into a web page would widen its exposure to browser history, screenshots,
 * and screen recordings for no gain — nobody needs to READ a key they already
 * set. What a user wants to know is whether recall goes out over the network at
 * all, which these four fields answer completely.
 */
interface RemoteEmbeddingView {
  configured: boolean;
  endpointHost: string | null;
  hasApiKey: boolean;
  model: string | null;
  /**
   * Where to go to change any of this. Read-only on the page is a decision, not
   * an omission — the trio only works as a unit and one member is a secret — so
   * the card owes the reader the file it would have edited. A path, not a
   * value: naming a file discloses nothing the reader could not already read.
   */
  configPath: string;
}

/**
 * The eight reminder thresholds, presented as one choice.
 *
 * `active` is DERIVED from the current values on every read, never stored. A
 * persisted preset name would be a second source of truth: edit one of the eight
 * keys individually and the name would go on claiming a preset the configuration
 * no longer matches.
 */
interface ArchivePresetView {
  /** The preset the machine-wide values amount to, or null for "custom". */
  active: string | null;
  /** The keys this choice writes, so the page can mark them where they also appear. */
  keys: readonly string[];
  /**
   * Each option WITH its actual numbers. A three-way choice labelled only
   * "低频 / 标准 / 高频" hides what it does; the numbers are the content.
   */
  options: readonly { id: string; values: Readonly<Record<string, number>> }[];
}

export interface GlobalConfigView {
  /** Present only when the console was launched from a Fabric project. */
  currentProjectId: string | null;
  machine: FieldView[];
  archivePreset: ArchivePresetView;
  projects: ProjectView[];
  stores: StoreView[];
  remoteEmbedding: RemoteEmbeddingView;
  semanticSearch: SemanticSearchView;
  strings: Record<string, string>;
}

/**
 * Semantic search, as INTENT versus EFFECT.
 *
 * `embed_enabled` is a switch a user flips and the page then reports back to
 * them — which is a lie whenever the machine cannot honour it. The vector
 * channel additionally needs the server to resolve `fastembed` and the model to
 * be on disk (or a remote embedder configured), and neither is something the
 * switch can cause. So the row gets a second line saying whether the intent is
 * actually in force, and when it is not, which of the two is missing.
 *
 * `enabled` deliberately does NOT come from `gatherRecallStatus`: that reads the
 * launch directory's own resolution, while this page resolves the machine-wide
 * layer with a clean environment. Taking the probes from there and the intent
 * from here is the whole point — the probes are facts about the machine, the
 * intent is a layered decision.
 */
interface SemanticSearchView {
  enabled: boolean;
  /** Will the vector channel actually score? Mirrors `vector_ready`. */
  ready: boolean;
  /**
   * Why not, when `enabled` and not `ready`. `model-missing` resolves itself on
   * the next search (the model downloads); `package-missing` does not, and
   * needs a reinstall. Collapsing them into one "not working" would send the
   * first group off chasing a problem that fixes itself.
   */
  blocker: "package-missing" | "model-missing" | null;
  /** True when a remote embedder serves the channel and no local model is needed. */
  remote: boolean;
  model: string;
  modelCacheDir: string;
}

function hostOf(endpoint: unknown): string | null {
  if (typeof endpoint !== "string" || endpoint.length === 0) return null;
  try {
    return new URL(endpoint).host;
  } catch {
    // Not a URL — report nothing rather than echoing an unparsed string that
    // might itself be the credential.
    return null;
  }
}

/**
 * Mirrors `config-loader.resolveRemoteEmbed` layer for layer:
 * `env > embed_remote.<field> > flat embed_<field>`, with the presence of an
 * ENDPOINT — not of the container object — as the remote-mode switch.
 *
 * Reading only the nested `embed_remote` shape was the first version of this,
 * and dogfooding against a real machine caught it: that machine carries the
 * pre-W2 flat keys, so remote embedding was on while the page reported it off.
 * A page whose purpose is "show what is actually in effect" cannot read a
 * narrower set of layers than the code it describes.
 */
function readRemoteEmbedding(global: Record<string, unknown>): RemoteEmbeddingView {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() !== "" ? v : undefined;
  const nested =
    global.embed_remote !== null &&
    typeof global.embed_remote === "object" &&
    !Array.isArray(global.embed_remote)
      ? (global.embed_remote as Record<string, unknown>)
      : {};

  const configPath = globalConfigPath();
  const endpoint =
    str(process.env.FABRIC_EMBED_ENDPOINT) ?? str(nested.endpoint) ?? str(global.embed_endpoint);
  if (endpoint === undefined) {
    return { configured: false, endpointHost: null, hasApiKey: false, model: null, configPath };
  }
  const apiKey =
    str(process.env.FABRIC_EMBED_API_KEY) ?? str(nested.api_key) ?? str(global.embed_api_key);
  const model =
    str(process.env.FABRIC_EMBED_MODEL) ?? str(nested.model) ?? str(global.embed_model);
  return {
    configured: true,
    endpointHost: hostOf(endpoint),
    hasApiKey: apiKey !== undefined,
    model: model ?? null,
    configPath,
  };
}

/**
 * @param enabled the machine-wide resolution of `embed_enabled` from this
 * page's own layer walk — see {@link SemanticSearchView} for why it is not
 * taken from the probe's own read.
 */
function readSemanticSearch(
  launchDir: string,
  enabled: boolean,
  remote: RemoteEmbeddingView,
): SemanticSearchView {
  const probe = gatherRecallStatus(launchDir);
  // The remote transport needs neither the local package nor the model, and it
  // only counts as configured with a key — an endpoint alone gets 401s, which
  // would show here as "ready" and in recall as silence.
  const remoteReady = remote.configured && remote.hasApiKey;
  const ready = enabled && (remoteReady || (probe.fastembed_resolvable && probe.model_cached));
  const blocker =
    !enabled || ready
      ? null
      : !probe.fastembed_resolvable
        ? ("package-missing" as const)
        : ("model-missing" as const);
  return {
    enabled,
    ready,
    blocker,
    remote: remoteReady,
    model: probe.embed_model,
    modelCacheDir: probe.model_cache_dir,
  };
}

/**
 * The layer a context TARGETS — the single layer a write built from this same
 * context would land in, and therefore the only one whose holding a value makes
 * "set here" true.
 *
 * It mirrors `applyFieldMutation`'s home selection exactly: `global_root` keys
 * go to the global file, `corpus` keys to the store, and preference keys to
 * `projects[<id>]` when the context carries a project id and to `defaults`
 * otherwise. The write side picks the same two branches off
 * `preferProjectScope && ctx.projectId !== null`, and every console caller
 * passes `preferProjectScope = target.scope === "project"`, which is true for
 * exactly the contexts built with a non-null project id.
 *
 * Keyed off the context rather than off the field alone because the SAME field
 * is rendered at three different layers on these pages — machine-wide, per
 * project, per store — and "is it set here" has a different answer at each. A
 * field-only helper would have to guess which section it was rendering for.
 */
export function layerOf(field: PanelFieldMeta, ctx: PanelContext): ValueSource {
  if (field.home === "global_root") return "global";
  if (field.home === "corpus") return "store";
  return ctx.projectId === null ? "defaults" : "project";
}

/**
 * One panel field, resolved against one context.
 *
 * Exported because the integrations page renders a handful of the same keys as
 * "behaviour" controls. It renders them through THIS function rather than
 * shaping its own row: the two pages must agree about what a key's effective
 * value, source, and editability are, and the cheapest way to guarantee that is
 * to have only one function that decides.
 */
export function viewOf(field: PanelFieldMeta, ctx: PanelContext): FieldView {
  const key = String(field.key);
  const { value, source } = resolveEffective(field, ctx);
  const layer = layerOf(field, ctx);
  return {
    key,
    group: field.group,
    home: field.home,
    label: t(field.label_i18n_key),
    description: t(field.description_i18n_key),
    type: field.type,
    widget: field.widget,
    ...(field.enum_values === undefined ? {} : { enumValues: field.enum_values }),
    effective: field.format_for_display(value),
    source,
    sourceLabel: t(`cli.config.source.${source}`),
    tier: tierOf(key),
    modified: source === layer,
    inherited: source !== layer && source !== "default",
    envVar: envOverrideFor(key),
    editable: source !== "env",
  };
}

/** Machine-wide: the defaults segment plus the one global-root key. */
function machineFields(global: Record<string, unknown>): FieldView[] {
  // applyEnv:false — this section describes what a process with a CLEAN
  // environment resolves. Folding the console's own variables in would report
  // this shell's state as the machine's.
  const ctx = buildPanelContext({ projectId: null, storeRoot: null, applyEnv: false, global });
  return getPanelFields()
    .filter((f) => f.home !== "corpus")
    .map((f) => viewOf(f, ctx));
}

/**
 * Which preset the machine-wide values currently amount to.
 *
 * `applyEnv:false` for the same reason `machineFields` uses it: this describes
 * what a clean process resolves, not what this console's shell happens to hold.
 * Reading through `resolveEffective` (rather than off the `defaults` segment)
 * is what makes an unset key count as its code default — which is how a machine
 * where nothing was ever configured reads back as "standard" instead of the
 * meaningless "custom".
 */
function archivePresetView(global: Record<string, unknown>): ArchivePresetView {
  const ctx = buildPanelContext({ projectId: null, storeRoot: null, applyEnv: false, global });
  const effective: Record<string, unknown> = {};
  for (const field of getPanelFields()) {
    const key = String(field.key);
    if (!ARCHIVE_PRESET_KEYS.includes(key)) continue;
    const { value } = resolveEffective(field, ctx);
    effective[key] = value ?? field.default;
  }
  return {
    active: matchArchivePreset(effective),
    keys: ARCHIVE_PRESET_KEYS,
    options: ARCHIVE_PRESETS.map((p) => ({ id: p.id, values: p.values })),
  };
}

/**
 * A project's row shows the keys it OVERRIDES, not all eighteen.
 *
 * Eighteen keys times N projects is a wall, and it misrepresents the intent:
 * a per-project setting exists to break one rule for one repo, so the useful
 * view is "what is different here", with everything else visibly inherited.
 */
function projectOverrides(
  project: MergedProject,
  global: Record<string, unknown>,
  currentCtx: PanelContext | null,
): FieldView[] {
  if (project.projectId === null) return [];
  const segment = asPlainObject(asPlainObject(global.projects)[project.projectId]);
  const ctx =
    project.isCurrent && currentCtx !== null
      ? currentCtx
      : buildPanelContext({
          projectId: project.projectId,
          storeRoot: null,
          applyEnv: false,
          global,
        });
  return getPanelFields()
    .filter((f) => f.home === "preference" && segment[String(f.key)] !== undefined)
    .map((f) => viewOf(f, ctx));
}

/** Corpus keys, per mounted store. Exactly one key today, deliberately generic. */
function storeViews(global: Record<string, unknown>): StoreView[] {
  const globalRoot = resolveGlobalRoot();
  const corpusFields = getPanelFields().filter((f) => f.home === "corpus");
  const mounts = Array.isArray(global.stores) ? global.stores : [];

  return mounts.flatMap((raw): StoreView[] => {
    const mount = asPlainObject(raw);
    const storeUuid = mount.store_uuid;
    if (typeof storeUuid !== "string" || storeUuid.length === 0) return [];
    const storeRoot = join(
      globalRoot,
      storeRelativePathForMount(mount as { store_uuid: string; mount_name?: string }),
    );
    const ctx = buildPanelContext({ projectId: null, storeRoot, applyEnv: false, global });
    return [
      {
        storeUuid,
        alias: typeof mount.alias === "string" ? mount.alias : storeUuid,
        personal: mount.personal === true,
        fields: corpusFields.map((f) => viewOf(f, ctx)),
      },
    ];
  });
}

/**
 * Page chrome, resolved server-side so the page honours the machine-wide
 * `language` the same way the CLI does.
 */
function chromeStrings(): Record<string, string> {
  const keys = [
    "title",
    "intro",
    "machine.title",
    "machine.intro",
    "projects.title",
    "projects.intro",
    "projects.empty",
    "projects.empty-hint",
    "projects.current",
    "projects.no-overrides",
    "projects.override-count",
    "projects.add",
    "projects.add-placeholder",
    "projects.unbound",
    "projects.unregistered",
    "projects.stale",
    "projects.inherited",
    "stores.title",
    "stores.intro",
    "stores.empty",
    "stores.personal",
    "group.A_locale",
    "group.B_hint_threshold",
    "group.C_audit",
    "group.D_behavior",
    "search",
    "search-empty",
    "advanced.title",
    "advanced.intro",
    "advanced.count",
    "modified",
    "inherited-from",
    "scope-note",
    "reset",
    "reset-done",
    "preset.title",
    "preset.intro",
    "preset.custom",
    "preset.custom-hint",
    "preset.relaxed",
    "preset.standard",
    "preset.attentive",
    "preset.applied",
    "preset.partial",
    "save",
    "saved",
    "save-failed",
    "env-locked",
    "env-available",
    "loading",
    "load-failed",
    "remote.title",
    "remote.off",
    "remote.on",
    "remote.key-set",
    "remote.key-missing",
    "remote.how",
    "semantic.ready",
    "semantic.off",
    "semantic.remote",
    "semantic.model-missing",
    "semantic.package-missing",
  ] as const;
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = t(`cli.console.config.${key}`);
  return out;
}

/**
 * @param launchDir the directory the console was started in. It contributes
 * exactly one thing — which project is marked `isCurrent` — and must not
 * influence what the payload contains.
 */
export async function collectGlobalConfigView(launchDir: string): Promise<GlobalConfigView> {
  const global = asPlainObject(loadGlobalConfig(resolveGlobalRoot()));
  const currentCtx = loadPanelContext(launchDir);
  const currentProjectId = currentCtx.projectId;

  const projects = await collectKnownProjects(launchDir);

  const machine = machineFields(global);
  const remoteEmbedding = readRemoteEmbedding(global);

  return {
    currentProjectId,
    machine,
    archivePreset: archivePresetView(global),
    projects: projects.map((project) => ({
      ...project,
      overrides: projectOverrides(project, global, currentCtx),
    })),
    stores: storeViews(global),
    remoteEmbedding,
    semanticSearch: readSemanticSearch(
      launchDir,
      machine.find((f) => f.key === SEMANTIC_SEARCH_KEY)?.effective === "true",
      remoteEmbedding,
    ),
    strings: chromeStrings(),
  };
}
