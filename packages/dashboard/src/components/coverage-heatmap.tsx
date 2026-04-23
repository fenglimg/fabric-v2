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
    <section className="topology-card">
      <div className="topology-card-head">
        <div>
          <h3>{t("dashboard.rule-topology.heatmap.title")}</h3>
          <p className="muted">{t("dashboard.rule-topology.heatmap.subtitle")}</p>
        </div>
        <span className="badge badge-level">{t("dashboard.rule-topology.heatmap.count", { count: String(coverage.length) })}</span>
      </div>
      {coverage.length === 0 ? (
        <div className="empty-card">{t("dashboard.rule-topology.heatmap.empty")}</div>
      ) : (
        <div className="coverage-grid" role="list" aria-label={t("dashboard.rule-topology.heatmap.aria-label")}>
          {coverage.map((entry) => (
            <article key={entry.path} className={`coverage-row coverage-${entry.density}`} role="listitem">
              <div className="coverage-row-main">
                <span className="coverage-path">{entry.path}</span>
                <span className={`badge coverage-chip coverage-chip-${entry.density}`}>
                  {t(`dashboard.rule-topology.heatmap.density.${entry.density}`)}
                </span>
              </div>
              <div className="coverage-row-meta">
                <span>{t("dashboard.rule-topology.heatmap.rules", { count: String(entry.directRuleCount) })}</span>
                <span>{entry.matchingGlobs.slice(0, 2).join(" · ") || t("dashboard.rule-topology.heatmap.uncovered")}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
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
