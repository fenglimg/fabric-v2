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
import { loadGlobalConfig, resolveGlobalRoot } from "../store/global-config-io.js";
import { listRegisteredProjects } from "../store/project-registry-io.js";
import {
  asPlainObject,
  buildPanelContext,
  loadPanelContext,
  resolveEffective,
  type PanelContext,
  type ValueSource,
} from "./config-resolve.js";
import { mergeProjectList, type MergedProject } from "./project-list.js";

interface FieldView {
  key: string;
  group: string;
  home: "global_root" | "preference" | "corpus";
  label: string;
  description: string;
  type: "boolean" | "number" | "string";
  widget: "select" | "text";
  enumValues?: readonly string[];
  /** Rendered through the field's own `format_for_display`. */
  effective: string;
  source: ValueSource;
  sourceLabel: string;
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
}

export interface GlobalConfigView {
  /** Present only when the console was launched from a Fabric project. */
  currentProjectId: string | null;
  machine: FieldView[];
  projects: ProjectView[];
  stores: StoreView[];
  remoteEmbedding: RemoteEmbeddingView;
  strings: Record<string, string>;
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

  const endpoint =
    str(process.env.FABRIC_EMBED_ENDPOINT) ?? str(nested.endpoint) ?? str(global.embed_endpoint);
  if (endpoint === undefined) {
    return { configured: false, endpointHost: null, hasApiKey: false, model: null };
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
  };
}

function viewOf(field: PanelFieldMeta, ctx: PanelContext): FieldView {
  const key = String(field.key);
  const { value, source } = resolveEffective(field, ctx);
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

  const projects = mergeProjectList({
    registry: await listRegisteredProjects(),
    configuredIds: Object.keys(asPlainObject(global.projects)),
    currentProjectId,
  });

  return {
    currentProjectId,
    machine: machineFields(global),
    projects: projects.map((project) => ({
      ...project,
      overrides: projectOverrides(project, global, currentCtx),
    })),
    stores: storeViews(global),
    remoteEmbedding: readRemoteEmbedding(global),
    strings: chromeStrings(),
  };
}
