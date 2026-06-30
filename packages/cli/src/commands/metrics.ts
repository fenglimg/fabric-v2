// v2.0.0-rc.37 Wave B (NEW-34): `fabric metrics` CLI dashboard.
//
// Reads `.fabric/metrics.jsonl` (the counter sidecar populated by the
// server's 60s bumpCounter flush — see services/metrics.ts) and prints a
// text dashboard summarising counter activity over the requested window.
//
// Default: human-readable table. `--json` emits the raw aggregated
// payload for downstream tooling (e.g. CI graph exporters, ralph-style
// observability sinks).

import { resolve } from "node:path";

import { defineCommand } from "citty";

import { readMetrics, type MetricsRow } from "@fenglimg/fabric-server";
import type { Translator } from "@fenglimg/fabric-shared";

import { paint } from "../colors.js";
import { getProjectTranslator } from "../i18n.js";
import { grid, groupDot, headerRule } from "../tui/structure.js";

interface MetricsArgs {
  json?: boolean;
  target?: string;
  since?: string;
}

type Aggregated = {
  windowDescription: string;
  rowCount: number;
  totals: Record<string, number>;
  perEntryConsumed: Record<string, number>;
  rangeStart: string | null;
  rangeEnd: string | null;
};

function parseSinceArg(raw: string | undefined, t: Translator): number {
  if (raw === undefined || raw.length === 0) return 0;
  // Accepts plain integer seconds, or 1d / 24h / 30m / 90s shorthand.
  const match = /^(\d+)([smhd]?)$/u.exec(raw);
  if (match === null) {
    throw new Error(t("cli.metrics.invalid-since", { raw }));
  }
  const n = Number.parseInt(match[1]!, 10);
  const unit = match[2] ?? "s";
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * (multipliers[unit] ?? 1000);
}

function aggregate(rows: MetricsRow[], sinceMs: number, now: Date): Aggregated {
  const cutoff = sinceMs > 0 ? now.getTime() - sinceMs : 0;
  const filtered = rows.filter((r) => {
    if (cutoff === 0) return true;
    const ts = Date.parse(r.timestamp);
    return Number.isFinite(ts) && ts >= cutoff;
  });
  const totals: Record<string, number> = {};
  const perEntryConsumed: Record<string, number> = {};
  for (const row of filtered) {
    for (const [name, count] of Object.entries(row.counters)) {
      if (name.startsWith("knowledge_consumed:")) {
        const id = name.slice("knowledge_consumed:".length);
        perEntryConsumed[id] = (perEntryConsumed[id] ?? 0) + count;
        totals["knowledge_consumed"] = (totals["knowledge_consumed"] ?? 0) + count;
        continue;
      }
      totals[name] = (totals[name] ?? 0) + count;
    }
  }
  return {
    // Stable token (NOT localized) so the --json contract is locale-independent;
    // renderText localizes "all-time" at presentation time only.
    windowDescription: sinceMs > 0 ? formatDuration(sinceMs) : "all-time",
    rowCount: filtered.length,
    totals,
    perEntryConsumed,
    rangeStart: filtered[0]?.timestamp ?? null,
    rangeEnd: filtered[filtered.length - 1]?.timestamp ?? null,
  };
}

function formatDuration(ms: number): string {
  if (ms >= 86_400_000) return `${Math.round(ms / 86_400_000)}d`;
  if (ms >= 3_600_000) return `${Math.round(ms / 3_600_000)}h`;
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

// Two-space indent a multi-line block (grid table) into the body column.
function indentBlock(block: string): string {
  return block
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function renderText(agg: Aggregated, t: Translator): string {
  // flat-design (W3-D reskin, mirrors audit/doctor): B-横线 title (headerRule) +
  // aligned grid() tables + a C-圆点 (groupDot) section head — no hand-padded
  // ASCII dash-rule tables, no hardcoded English column heads.
  const lines: string[] = [];
  const windowDisplay =
    agg.windowDescription === "all-time" ? t("cli.metrics.window-all-time") : agg.windowDescription;
  lines.push(headerRule(t("cli.metrics.window", { window: windowDisplay })));
  const rowsLine =
    agg.rangeStart && agg.rangeEnd
      ? t("cli.metrics.rows-range", {
          count: String(agg.rowCount),
          start: agg.rangeStart,
          end: agg.rangeEnd,
        })
      : t("cli.metrics.rows", { count: String(agg.rowCount) });
  lines.push(paint.muted(rowsLine));
  lines.push("");
  if (Object.keys(agg.totals).length === 0) {
    lines.push(paint.muted(t("cli.metrics.no-activity")));
    return lines.join("\n");
  }
  const counterRows: string[][] = [[t("cli.metrics.col.counter"), t("cli.metrics.col.total")]];
  const sorted = Object.entries(agg.totals).sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sorted) {
    counterRows.push([name, String(count)]);
  }
  lines.push(indentBlock(grid(counterRows, { rule: true })));
  // Top per-entry consumed leaderboard (helps spot hot KB entries / Goodhart).
  const perEntrySorted = Object.entries(agg.perEntryConsumed).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (perEntrySorted.length > 0) {
    lines.push("");
    lines.push(groupDot(t("cli.metrics.section.perEntry")));
    const peRows: string[][] = [[t("cli.metrics.col.entry"), t("cli.metrics.col.total")]];
    for (const [id, count] of perEntrySorted) {
      peRows.push([id, String(count)]);
    }
    lines.push(indentBlock(grid(peRows, { rule: true })));
  }
  return lines.join("\n");
}

export const metricsCommand = defineCommand({
  meta: {
    name: "metrics",
    description: "Print a text dashboard of Fabric counter activity from .fabric/metrics.jsonl",
    hidden: true,
  },
  args: {
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON instead of the text table.",
      default: false,
    },
    target: {
      type: "string",
      description: "Project root (defaults to the current working directory).",
    },
    since: {
      type: "string",
      description: "Limit to rows within a recent window. Examples: 24h, 7d, 30m, 90s. Omit for all-time.",
    },
  },
  async run({ args }: { args: MetricsArgs }) {
    const projectRoot = resolve(args.target ?? process.cwd());
    const t = getProjectTranslator(projectRoot);
    const sinceMs = parseSinceArg(args.since, t);
    const rows = await readMetrics(projectRoot);
    const aggregated = aggregate(rows, sinceMs, new Date());
    if (args.json === true) {
      process.stdout.write(`${JSON.stringify(aggregated)}\n`);
    } else {
      process.stdout.write(`${renderText(aggregated, t)}\n`);
    }
  },
});

export default metricsCommand;
