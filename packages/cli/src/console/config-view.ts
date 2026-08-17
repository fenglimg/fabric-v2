// ---------------------------------------------------------------------------
// `GET /api/config` — what this project is actually configured to do, and where
// each value comes from.
//
// The user's stated complaint was "editing config from the CLI is slow", but
// `fabric config` is already an interactive panel with schema-introspected
// fields, so entry speed was never the bottleneck. The bottleneck is that a
// value can live in one of four places and nothing shows you which one won. That
// is the failure KT-MOD-0004 calls the hardest to debug: the value you can see
// is not the value in effect.
//
// Assembly only, same rule as status.ts: every value comes from
// `resolveEffective` — the function the CLI panel uses. This module must not
// re-derive an answer, because a second producer is a second thing that can
// disagree, and "the console says X, `fabric config` says Y" is worse than
// having no console.
// ---------------------------------------------------------------------------

import { getPanelFields, envOverrideFor, type PanelFieldMeta } from "@fenglimg/fabric-shared";

import { t } from "../i18n.js";
import { loadPanelContext, resolveEffective, type PanelContext, type ValueSource } from "./config-resolve.js";

interface ConfigFieldView {
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
  /** False while an env var is deciding — writing a file would not take effect. */
  editable: boolean;
}

/**
 * Remote embedding, reported as SHAPE not CONTENT.
 *
 * `~/.fabric/fabric-global.json` really does hold a plaintext API key. Rendering
 * it into a web page would widen its exposure to browser history, screenshots,
 * and screen recordings for no gain — nobody needs to READ a key they already
 * set. What a user actually wants to know is whether recall is going out over
 * the network at all, which these four fields answer completely.
 *
 * The endpoint is reduced to a hostname because full URLs carry credentials in
 * query strings often enough that echoing one back is not worth the risk.
 */
interface RemoteEmbeddingView {
  configured: boolean;
  endpointHost: string | null;
  hasApiKey: boolean;
  model: string | null;
}

export interface ConfigView {
  projectRoot: string;
  projectId: string | null;
  storeRoot: string | null;
  fields: ConfigFieldView[];
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
 * pre-W2 flat keys, so remote embedding was on while this page reported it off.
 * A page whose whole purpose is "show what is actually in effect" cannot afford
 * to read a narrower set of layers than the code it describes.
 */
function readRemoteEmbedding(ctx: PanelContext): RemoteEmbeddingView {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() !== "" ? v : undefined;
  const flat = ctx.global;
  const nested =
    flat.embed_remote !== null &&
    typeof flat.embed_remote === "object" &&
    !Array.isArray(flat.embed_remote)
      ? (flat.embed_remote as Record<string, unknown>)
      : {};

  const endpoint =
    str(process.env.FABRIC_EMBED_ENDPOINT) ?? str(nested.endpoint) ?? str(flat.embed_endpoint);
  if (endpoint === undefined) {
    return { configured: false, endpointHost: null, hasApiKey: false, model: null };
  }
  const apiKey =
    str(process.env.FABRIC_EMBED_API_KEY) ?? str(nested.api_key) ?? str(flat.embed_api_key);
  const model = str(process.env.FABRIC_EMBED_MODEL) ?? str(nested.model) ?? str(flat.embed_model);
  return {
    configured: true,
    endpointHost: hostOf(endpoint),
    hasApiKey: apiKey !== undefined,
    model: model ?? null,
  };
}

function viewOf(field: PanelFieldMeta, ctx: PanelContext): ConfigFieldView {
  const key = String(field.key);
  const { value, source } = resolveEffective(field, ctx);
  const envVar = envOverrideFor(key);
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
    envVar,
    editable: source !== "env",
  };
}

/**
 * Page chrome, resolved server-side.
 *
 * Delivered with the data rather than baked into the HTML so the page honours
 * the machine-wide `language` the same way the CLI does. A template with
 * hard-coded Chinese renders as a mix on an `en` machine, which is what the
 * earlier console pages currently do.
 */
function chromeStrings(): Record<string, string> {
  const keys = [
    "title",
    "intro",
    "group.A_locale",
    "group.B_hint_threshold",
    "group.C_audit",
    "group.D_behavior",
    "scope.label",
    "scope.project",
    "scope.defaults",
    "scope.unavailable",
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
    "store-missing",
  ] as const;
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = t(`cli.console.config.${key}`);
  return out;
}

export function collectConfigView(projectRoot: string): ConfigView {
  const ctx = loadPanelContext(projectRoot);
  return {
    projectRoot,
    projectId: ctx.projectId,
    storeRoot: ctx.storeRoot,
    // Straight off the introspection registry — no hand-written field list, so a
    // key added to or removed from the schema shows up here with no edit.
    fields: getPanelFields().map((field) => viewOf(field, ctx)),
    remoteEmbedding: readRemoteEmbedding(ctx),
    strings: chromeStrings(),
  };
}
