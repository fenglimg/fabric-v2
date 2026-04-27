import type { AgentsMeta, AgentsMetaNode, FabricEvent } from "@fenglimg/fabric-shared";
import { withDerivedAgentsMetaNodeDefaults } from "@fenglimg/fabric-shared";
import { useEffect, useMemo, useState } from "preact/hooks";

import { getRules, getRulesContext, type RulesContextPayload } from "../api/client";
import { CoverageHeatmap, DriftIndicator, HitReasonPanel, TreeNode, type TreeNodeProps } from "../components";
import { useI18n } from "../i18n/use-i18n";

export const DEFAULT_RULES_CONTEXT_PATH = "packages/dashboard/src/views/rules-explain.tsx";

export function ViewHeader({ title, subtitle }: { title: string; subtitle: string }) {
  // This is no longer heavily used in the new Layout because Header is at App level,
  // but if kept for fallback/inner spacing, we make it minimal.
  return null;
}

export function buildRulesTree(meta: AgentsMeta, lockFiles: Set<string>, filter: string): TreeNodeProps[] {
  const query = filter.trim().toLowerCase();
  const entries = Object.values(meta.nodes)
    .filter((node) => query.length === 0 || JSON.stringify(node).toLowerCase().includes(query))
    .sort((left, right) => left.file.localeCompare(right.file));
  const groups = new Map<string, AgentsMetaNode[]>();

  for (const node of entries) {
    const group = node.file.split("/")[0] ?? "root";
    groups.set(group, [...(groups.get(group) ?? []), node]);
  }

  const root: AgentsMetaNode = withDerivedAgentsMetaNodeDefaults({
    file: `revision:${meta.revision}`,
    scope_glob: "**/*",
    deps: [],
    priority: "high",
    hash: meta.revision,
  });

  return [{
    node: root,
    level: 0,
    defaultExpanded: true,
    children: Array.from(groups.entries()).map(([group, nodes]) => ({
      node: withDerivedAgentsMetaNodeDefaults({
        file: group,
        scope_glob: `${group}/**/*`,
        deps: [],
        priority: "medium",
        hash: `${nodes.length} nodes`,
      }),
      level: 1,
      defaultExpanded: true,
      children: nodes.map((node) => ({
        node,
        level: 2,
        humanLockedNearby: lockFiles.has(node.file),
        staleReason: node.hash.length === 0 ? "hash-mismatch" : null,
      })),
    })),
  }];
}

export type RulesExplainViewProps = {
  lastEvent: FabricEvent | null;
};

export function RulesExplainView({ lastEvent }: RulesExplainViewProps) {
  const { t } = useI18n();
  const [meta, setMeta] = useState<AgentsMeta | null>(null);
  const [rulesContext, setRulesContext] = useState<RulesContextPayload | null>(null);
  
  const [pathInput, setPathInput] = useState(DEFAULT_RULES_CONTEXT_PATH);
  const [activePath, setActivePath] = useState(DEFAULT_RULES_CONTEXT_PATH);
  
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [treeFilter, setTreeFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async (path: string) => {
    try {
      const [nextMeta, nextContext] = await Promise.all([
        getRules(),
        getRulesContext(path),
      ]);
      setMeta(nextMeta);
      setRulesContext(nextContext);
      setActivePath(path);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  };

  useEffect(() => {
    void load(DEFAULT_RULES_CONTEXT_PATH);
  }, []);

  useEffect(() => {
    if (lastEvent?.type === "meta:updated" || lastEvent?.type === "drift:detected" || lastEvent?.type === "lock:drift") {
      void load(activePath);
    }
  }, [activePath, lastEvent]);

  const lockFiles = useMemo(() => new Set<string>(), []);
  const tree = useMemo(() => meta === null ? [] : buildRulesTree(meta, lockFiles, treeFilter), [meta, lockFiles, treeFilter]);
  const selectedNode = selectedNodeId === null ? null : meta?.nodes[selectedNodeId] ?? null;

  const nodesList = useMemo(() => meta === null ? [] : Object.values(meta.nodes), [meta]);
  const hitCount = (rulesContext?.L1.length ?? 0) + (rulesContext?.L2.length ?? 0) + (rulesContext?.description_stubs?.length ?? 0);

  return (
    <div class="flex-1 flex flex-col gap-4 min-h-0 relative">
      {error !== null ? (
        <div class="z-50 px-4 pt-2 shrink-0">
          <DriftIndicator kind="banner" severity="stale" message={error} />
        </div>
      ) : null}
      
      <div class="flex-1 flex flex-col md:flex-row gap-4 min-h-0">
      
        {/* Left Pane: Registry Tree */}
        <div class="w-full md:w-1/3 xl:w-1/4 flex flex-col overflow-hidden bg-light-surface border-r border-light-border sm:border sm:rounded-2xl sm:shadow-sm dark:bg-dark-surface dark:border-white/5 dark:backdrop-blur-3xl dark:shadow-xl">
          <div class="p-4 border-b border-light-border dark:border-dark-border flex justify-between items-center bg-light-surface/90 dark:bg-transparent z-10 shrink-0">
            <span class="text-xs font-bold uppercase tracking-wider text-light-muted dark:text-dark-muted">Registry Tree</span>
            <span class="text-[10px] font-mono bg-light-border/50 dark:bg-white/10 px-2 py-0.5 rounded-full border border-light-border dark:border-dark-border">
              {meta === null ? "..." : `${Object.keys(meta.nodes).length} Nodes`}
            </span>
          </div>
          
          <div class="p-3 border-b border-light-border dark:border-dark-border shrink-0 flex gap-2">
            <input
              class="flex-1 px-3 py-1.5 rounded-lg text-sm bg-light-border/30 border border-light-border text-light-text dark:bg-black/20 dark:border-dark-border dark:text-dark-text placeholder:text-light-muted dark:placeholder:text-dark-muted focus:outline-none focus:ring-2 focus:ring-brand-accent/50 transition-shadow"
              value={treeFilter}
              onInput={(event) => setTreeFilter(event.currentTarget.value)}
              placeholder={t("dashboard.rules-tree.filter.placeholder")}
              aria-label={t("dashboard.rules-tree.filter.aria-label")}
            />
            <button class="px-3 py-1.5 rounded-lg text-sm font-medium bg-light-border/50 hover:bg-light-border text-light-text dark:bg-white/10 dark:hover:bg-white/20 dark:text-dark-text transition-colors" type="button" onClick={() => void load(activePath)}>
              ↻
            </button>
          </div>

          <div class="p-3 overflow-y-auto space-y-0.5 flex-1" role="tree" aria-label={t("dashboard.rules-tree.tree.aria-label")}>
            {tree.length > 0 ? tree.map((node) => (
              <TreeNode
                key={node.node.file}
                {...node}
                selected={node.node.file === selectedNodeId}
                onSelect={(id) => {
                  setSelectedNodeId(id);
                  if (id) {
                    setPathInput(id);
                    void load(id);
                  }
                }}
              />
            )) : (
              <div class="p-4 text-center text-sm text-light-muted dark:text-dark-muted">
                {meta === null ? t("dashboard.rules-tree.status.loading") : t("dashboard.rules-tree.empty")}
              </div>
            )}
          </div>
        </div>

        {/* Right Pane: Detail & Context */}
        <div class="flex-1 flex flex-col overflow-hidden bg-light-surface border border-light-border sm:rounded-2xl sm:shadow-sm dark:bg-dark-surface dark:border-white/5 dark:backdrop-blur-3xl dark:shadow-xl">
          <div class="p-6 md:p-8 overflow-y-auto flex-1">
            
            <div class="flex items-center gap-2 mb-6">
              <input
                class="flex-1 px-3 py-2 rounded-lg text-sm bg-light-border/30 border border-light-border text-light-text dark:bg-black/20 dark:border-dark-border dark:text-dark-text focus:outline-none focus:ring-2 focus:ring-brand-accent/50 transition-shadow font-mono"
                value={pathInput}
                onInput={(event) => setPathInput(event.currentTarget.value)}
                placeholder={t("dashboard.rule-topology.path.placeholder")}
                aria-label={t("dashboard.rule-topology.path.aria-label")}
              />
              <button
                class="px-4 py-2 rounded-lg text-sm font-medium bg-brand-accent/10 text-brand-accent hover:bg-brand-accent/20 border border-brand-accent/20 dark:bg-brand-accent/20 dark:text-brand-accent dark:border-brand-accent/30 dark:hover:bg-brand-accent/30 transition-colors whitespace-nowrap"
                type="button"
                onClick={() => void load(pathInput.trim().length > 0 ? pathInput.trim() : DEFAULT_RULES_CONTEXT_PATH)}
              >
                {t("dashboard.rules-explain.analyze")}
              </button>
            </div>
            
            <div class="flex justify-between items-center mb-8 px-4 py-3 rounded-xl border bg-light-bg/50 border-light-border dark:bg-black/20 dark:border-dark-border text-sm font-mono">
              <span class="text-light-muted dark:text-dark-muted">{t("dashboard.rule-topology.status.sample", { path: activePath })}</span>
              <span class="font-bold text-light-text dark:text-dark-text">{t("dashboard.rule-topology.status.hits", { count: String(hitCount) })}</span>
            </div>

            {selectedNode !== null ? (
              <div class="mb-8">
                <div class="inline-block px-2.5 py-1 text-xs font-bold rounded-lg font-mono mb-3 border bg-brand-accent/10 text-brand-accent border-brand-accent/20 dark:bg-purple-500/20 dark:text-purple-300 dark:border-purple-500/30 uppercase">
                  {selectedNode.priority} Priority
                </div>
                <div class="flex justify-between items-start mb-6">
                  <div>
                    <h2 class="text-2xl font-bold font-mono tracking-tight text-light-text dark:text-white/90 break-all">{selectedNode.file}</h2>
                  </div>
                  <div class="text-right hidden sm:block shrink-0 ml-4">
                    <div class="text-[10px] font-bold text-light-muted dark:text-dark-muted uppercase tracking-widest mb-1">Hash Revision</div>
                    <div class="font-mono text-xs px-2.5 py-1 rounded-md border bg-light-border/30 border-light-border text-light-text dark:bg-black/30 dark:border-dark-border dark:text-dark-text shadow-inner">
                      {selectedNode.hash.substring(0, 12)}...
                    </div>
                  </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                  <div class="p-4 rounded-xl border bg-light-bg/50 border-light-border dark:bg-black/20 dark:border-dark-border">
                    <div class="text-[10px] font-bold text-light-muted dark:text-dark-muted uppercase tracking-widest mb-2">{t("dashboard.rules-tree.detail.scope")}</div>
                    <div class="font-mono text-sm font-medium text-light-text dark:text-dark-text break-all">{selectedNode.scope_glob}</div>
                  </div>
                  {selectedNode.topology_type && (
                    <div class="p-4 rounded-xl border bg-light-bg/50 border-light-border dark:bg-black/20 dark:border-dark-border">
                      <div class="text-[10px] font-bold text-light-muted dark:text-dark-muted uppercase tracking-widest mb-2">{t("dashboard.rules-explain.detail.topology-type")}</div>
                      <div class="font-mono text-sm font-medium text-light-text dark:text-dark-text">{selectedNode.topology_type}</div>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div>
                <h3 class="text-sm font-bold uppercase tracking-wider text-light-muted dark:text-dark-muted mb-4">Hit Reasons</h3>
                <HitReasonPanel meta={meta} rulesContext={rulesContext} />
              </div>
              <div>
                <h3 class="text-sm font-bold uppercase tracking-wider text-light-muted dark:text-dark-muted mb-4">Coverage Heatmap</h3>
                <CoverageHeatmap nodes={nodesList} />
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div class="flex justify-between py-1 border-b border-light-border dark:border-dark-border border-dashed font-mono text-sm">
      <span class="text-light-muted dark:text-dark-muted">{label}</span>
      <span class="text-light-text dark:text-dark-text text-right break-all ml-4">{value}</span>
    </div>
  );
}
