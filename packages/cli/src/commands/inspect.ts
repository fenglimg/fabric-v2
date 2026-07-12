import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineCommand } from "citty";

import { runPlanContextHint, type PlanContextHintOutput } from "./plan-context-hint.js";
import { paint } from "../colors.js";
import { t } from "../i18n.js";
import { groupDot, headerRule } from "../tui/structure.js";

// ---------------------------------------------------------------------------
// Block 5 (Option X) / W3-F — `fabric inspect [--render human|ai] [--explain]`
// (renamed from `fabric context`; NS-01 §1: "context of what?" was unintuitive).
//
// D5-3 shared knowledge read path: inspect reuses SessionStart's
// plan-context / store resolver pipeline (createStoreResolver via
// runPlanContextHint) — NOT a second ad-hoc FS walk of knowledge/.
// first-hit uses createStoreResolver + listStoreKnowledge; preview uses
// collectStoreCanonicalEntries on the same store mounts.
//
// Shows exactly what the SessionStart hook injects this session. Byte-identity
// is structural, not best-effort: this command runs the SAME producer
// (`runPlanContextHint`) and the SAME renderer (`buildSessionStartSinks`, the
// hook's own exported orchestration) that the SessionStart hook uses — so
// `fabric inspect --render ai` === the hook's AI additionalContext, verbatim.
// The producer-consumer round-trip oracle (inspect-command.test.ts) pins this.
//
// `--explain` appends a per-entry provenance section (id · type · maturity ·
// scope · why-surfaced) on top of the byte-identical render — a diagnostic
// overlay, not part of the injection.
//
// The hook script is a standalone `.cjs` that cannot import `packages/`; this
// command bridges the other way — it `require()`s the installed template hook
// at runtime (located by walking up for `templates/hooks/...`). One renderer,
// two surfaces, no drift.
// ---------------------------------------------------------------------------

type RenderMode = "human" | "ai";

interface SessionStartSinks {
  human: string | null;
  ai: string | null;
  resolvedPayload: PlanContextHintOutput | null;
  hasRenderedContent: boolean;
  reminderToContext: boolean;
}

interface HookRenderer {
  buildSessionStartSinks: (cwd: string, payload: unknown, env: unknown) => SessionStartSinks;
}

// Walk up from this module for `templates/hooks/<rel>` — works in dev (src),
// under vitest (src), and bundled (dist), since `templates/` always sits at the
// CLI package root. Mirrors install/skills-and-hooks.ts#findTemplatePath.
function findTemplatePath(relativePath: string): string {
  const startDir = dirname(fileURLToPath(import.meta.url));
  let current = resolve(startDir);
  for (;;) {
    const candidate = join(current, "templates", relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current || parse(current).root === current) {
      throw new Error(`Template not found: templates/${relativePath} (searched up from ${startDir})`);
    }
    current = parent;
  }
}

function loadHookRenderer(): HookRenderer {
  const require = createRequire(import.meta.url);
  return require(findTemplatePath("hooks/knowledge-hint-broad.cjs")) as HookRenderer;
}

export interface RunInspectOptions {
  render?: RenderMode;
  explain?: boolean;
  target?: string;
  // Test seam: inject a canned plan-context-hint payload instead of running the
  // producer (mirrors the hook's env.payload seam). Production leaves it unset.
  payload?: PlanContextHintOutput;
}

// Build a per-entry provenance overlay for --explain. Not part of the injected
// bytes — a diagnostic listing of WHAT was surfaced and WHY.
function renderExplain(sinks: SessionStartSinks): string {
  const payload = sinks.resolvedPayload;
  // Flat-design overlay: command-level headerRule + ● section groups + flat
  // status-glyph lines. ✓ = always-active (body injected), ℹ = reference
  // (title-only, read on demand) — the glyph encodes injection state, not decor.
  const lines: string[] = ["", headerRule(t("cli.inspect.explain.title"))];

  const bodies = Array.isArray(payload?.always_bodies) ? payload!.always_bodies : [];
  if (bodies.length > 0) {
    lines.push("", groupDot(t("cli.inspect.explain.always")));
    for (const b of bodies) {
      lines.push(`  ${paint.success("✓")} [${b.type}] ${b.id}  ${b.summary}  ${paint.muted(b.layer)}`);
    }
  }

  const entries = Array.isArray(payload?.entries) ? payload!.entries : [];
  if (entries.length > 0) {
    lines.push("", groupDot(t("cli.inspect.explain.reference")));
    for (const e of entries) {
      const provenance = typeof e.related_to === "string" ? ` ←related-to:${e.related_to}` : "";
      const meta = paint.muted(`${e.maturity || "?"} · ${e.relevance_scope}${provenance}`);
      lines.push(`  ${paint.ai("ℹ")} [${e.type}] ${e.id}  ${e.summary}  ${meta}`);
      if (typeof e.must_read_if === "string" && e.must_read_if.length > 0) {
        lines.push(`    ${paint.muted(`must_read_if: ${e.must_read_if}`)}`);
      }
    }
  }

  const census = payload?.census;
  if (census) {
    const layer = census.by_layer ?? { team: 0, personal: 0, project: 0 };
    lines.push("", groupDot(t("cli.inspect.explain.census")));
    lines.push(
      `  [team]${layer.team ?? 0} [project]${layer.project ?? 0} [personal]${layer.personal ?? 0}  ${paint.muted(t("cli.inspect.explain.census-total", { total: String(census.total) }))}`,
    );
  }
  return lines.join("\n");
}

/**
 * Pure handler — exported for the round-trip oracle test. Returns the rendered
 * string (NOT printed). With `payload` injected it skips the producer so the
 * render path is testable without a built server fixture.
 */
export async function runInspect(opts: RunInspectOptions): Promise<string> {
  const cwd = opts.target ? resolve(opts.target) : process.cwd();
  const payload =
    opts.payload !== undefined
      ? opts.payload
      : await runPlanContextHint({ all: true, target: opts.target });

  const renderer = loadHookRenderer();
  const sinks = renderer.buildSessionStartSinks(cwd, payload, {});

  let base: string;
  if (opts.render === "ai") {
    base = sinks.ai ?? "";
  } else if (opts.render === "human") {
    base = sinks.human ?? "";
  } else {
    // Default: both channels, human first then the AI spine (blank-line
    // separated). Each channel is byte-identical to its corresponding sink.
    base = [sinks.human, sinks.ai].filter((s): s is string => typeof s === "string" && s.length > 0).join("\n\n");
  }

  // Empty render stays empty (no overlay) so the round-trip oracle holds.
  if (base.length === 0 && !sinks.hasRenderedContent) return "";

  return opts.explain === true ? base + "\n" + renderExplain(sinks) : base;
}

export const inspectCommand = defineCommand({
  meta: {
    name: "inspect",
    description: t("cli.inspect.description"),
  },
  args: {
    render: {
      type: "string",
      description: t("cli.inspect.arg.render"),
    },
    explain: {
      type: "boolean",
      description: t("cli.inspect.arg.explain"),
      default: false,
    },
    target: {
      type: "string",
      description: t("cli.inspect.arg.target"),
    },
  },
  async run({ args }: { args: { render?: string; explain?: boolean; target?: string } }) {
    try {
      const render = args.render === "human" || args.render === "ai" ? args.render : undefined;
      const out = await runInspect({ render, explain: args.explain === true, target: args.target });
      if (out.length > 0) process.stdout.write(`${out}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${paint.error("✗")} ${t("cli.inspect.error", { message })}\n`);
      process.exitCode = 1;
    }
  },
});

export default inspectCommand;
