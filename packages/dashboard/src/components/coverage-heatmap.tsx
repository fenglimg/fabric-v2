import type { AgentsMetaNode } from "@fenglimg/fabric-shared";

import { useI18n } from "../i18n/use-i18n";

export type CoverageDensity = "full" | "partial" | "none";

export type DirectoryCoverage = {
  path: string;
  density: CoverageDensity;
  matchingGlobs: string[];
  directRuleCount: number;
};

export function CoverageHeatmap({ nodes }: { nodes: AgentsMetaNode[] }) {
  const { t } = useI18n();
  const coverage = buildDirectoryCoverage(nodes);

  return (
    <section class="flex flex-col bg-light-surface border border-light-border sm:rounded-2xl sm:shadow-sm dark:bg-dark-surface dark:border-dark-border dark:shadow-xl overflow-hidden min-h-[280px]">
      <div class="p-4 border-b border-light-border dark:border-dark-border flex justify-between items-start bg-light-surface/90 dark:bg-transparent shrink-0">
        <div>
          <h3 class="text-sm font-bold text-light-text dark:text-dark-text m-0">{t("dashboard.rule-topology.heatmap.title")}</h3>
          <p class="text-xs text-light-muted dark:text-dark-muted mt-1">{t("dashboard.rule-topology.heatmap.subtitle")}</p>
        </div>
        <span class="text-[10px] font-mono bg-light-border/50 dark:bg-white/10 px-2 py-0.5 rounded-full border border-light-border dark:border-dark-border whitespace-nowrap">
          {t("dashboard.rule-topology.heatmap.count", { count: String(coverage.length) })}
        </span>
      </div>
      
      {coverage.length === 0 ? (
        <div class="p-8 flex-1 flex items-center justify-center text-sm text-light-muted dark:text-dark-muted">
          {t("dashboard.rule-topology.heatmap.empty")}
        </div>
      ) : (
        <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-3" role="list" aria-label={t("dashboard.rule-topology.heatmap.aria-label")}>
          {coverage.map((entry) => (
            <article key={entry.path} class={`p-3 rounded-xl border bg-light-bg/50 dark:bg-black/20 flex flex-col ${getDensityBorder(entry.density)}`} role="listitem">
              <div class="flex justify-between items-center gap-2">
                <span class="font-mono text-sm font-medium text-light-text dark:text-dark-text truncate">{entry.path}</span>
                <span class={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${getDensityClass(entry.density)}`}>
                  {t(`dashboard.rule-topology.heatmap.density.${entry.density}`)}
                </span>
              </div>
              <div class="flex justify-between items-center gap-2 mt-2 text-xs font-mono text-light-muted dark:text-dark-muted">
                <span class="whitespace-nowrap">{t("dashboard.rule-topology.heatmap.rules", { count: String(entry.directRuleCount) })}</span>
                <span class="truncate opacity-80">{entry.matchingGlobs.slice(0, 2).join(" · ") || t("dashboard.rule-topology.heatmap.uncovered")}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function getDensityClass(density: CoverageDensity): string {
  switch(density) {
    case "full": return "bg-green-500/10 text-green-600 border border-green-500/30 dark:bg-green-500/20 dark:text-green-400";
    case "partial": return "bg-amber-500/10 text-amber-600 border border-amber-500/30 dark:bg-amber-500/20 dark:text-amber-400";
    case "none": return "bg-slate-500/10 text-slate-600 border border-slate-500/30 dark:bg-slate-500/20 dark:text-slate-400";
  }
}

function getDensityBorder(density: CoverageDensity): string {
  switch(density) {
    case "full": return "border-l-4 border-l-green-500/50 border-t-light-border border-r-light-border border-b-light-border dark:border-t-dark-border dark:border-r-dark-border dark:border-b-dark-border";
    case "partial": return "border-l-4 border-l-amber-500/50 border-t-light-border border-r-light-border border-b-light-border dark:border-t-dark-border dark:border-r-dark-border dark:border-b-dark-border";
    case "none": return "border-l-4 border-l-slate-500/30 border-t-light-border border-r-light-border border-b-light-border dark:border-t-dark-border dark:border-r-dark-border dark:border-b-dark-border";
  }
}

export function buildDirectoryCoverage(nodes: AgentsMetaNode[]): DirectoryCoverage[] {
  const candidateDirectories = collectCandidateDirectories(nodes);
  const coverage = candidateDirectories.map((directory) => {
    const matchingNodes = nodes.filter((node) => directoryTouchesScope(directory, normalizeGlob(node.scope_glob)));
    const fullCoverage = matchingNodes.some((node) => scopeFullyCoversDirectory(directory, normalizeGlob(node.scope_glob)));

    return {
      path: directory,
      density: fullCoverage ? "full" : matchingNodes.length > 0 ? "partial" : "none",
      matchingGlobs: matchingNodes.map((node) => node.scope_glob),
      directRuleCount: matchingNodes.length,
    } satisfies DirectoryCoverage;
  });

  return coverage.sort((left, right) => left.path.localeCompare(right.path));
}

function collectCandidateDirectories(nodes: AgentsMetaNode[]): string[] {
  const directories = new Set<string>();

  for (const node of nodes) {
    for (const directory of toDirectoryAncestors(node.file)) {
      directories.add(directory);
    }

    const prefix = extractStaticPrefix(node.scope_glob);
    if (prefix.length > 0) {
      for (const directory of toDirectoryAncestors(prefix)) {
        directories.add(directory);
      }
    }
  }

  return Array.from(directories);
}

function toDirectoryAncestors(path: string): string[] {
  const normalized = normalizeGlob(path);
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return [];
  }

  const looksLikeFile = (segments.at(-1) ?? "").includes(".");
  const end = looksLikeFile ? segments.length - 1 : segments.length;
  const directories: string[] = [];

  for (let index = 1; index <= end; index += 1) {
    directories.push(segments.slice(0, index).join("/"));
  }

  return directories;
}

function extractStaticPrefix(scopeGlob: string): string {
  const segments = normalizeGlob(scopeGlob).split("/").filter(Boolean);
  const prefix: string[] = [];

  for (const segment of segments) {
    if (segment === "**" || /[*?[\]{}()!]/.test(segment)) {
      break;
    }

    prefix.push(segment);
  }

  return prefix.join("/");
}

function scopeFullyCoversDirectory(directory: string, scopeGlob: string): boolean {
  const prefix = extractStaticPrefix(scopeGlob);
  if (prefix.length === 0) {
    return false;
  }

  return prefix === directory && (scopeGlob === directory || scopeGlob.startsWith(`${directory}/**`) || scopeGlob.startsWith(`${directory}/*`));
}

function directoryTouchesScope(directory: string, scopeGlob: string): boolean {
  const prefix = extractStaticPrefix(scopeGlob);
  if (prefix.length === 0) {
    return true;
  }

  return prefix === directory || prefix.startsWith(`${directory}/`) || directory.startsWith(`${prefix}/`);
}

function normalizeGlob(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.?\//, "").replace(/\/+$/, "");
}