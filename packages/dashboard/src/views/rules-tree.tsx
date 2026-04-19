import type { AgentsMeta, AgentsMetaNode, FabricEvent } from "@fabric/shared";
import { useEffect, useMemo, useState } from "preact/hooks";

import { getHumanLock, getRules, type HumanLockStatus } from "../api/client";
import { DriftIndicator, TreeNode, type TreeNodeProps } from "../components";

export type RulesTreeViewProps = {
  lastEvent: FabricEvent | null;
};

export function RulesTreeView({ lastEvent }: RulesTreeViewProps) {
  const [rules, setRules] = useState<AgentsMeta | null>(null);
  const [locks, setLocks] = useState<HumanLockStatus[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [nextRules, nextLocks] = await Promise.all([getRules(), getHumanLock().catch(() => [])]);
      setRules(nextRules);
      setLocks(nextLocks);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (lastEvent?.type === "meta:updated" || lastEvent?.type === "drift:detected" || lastEvent?.type === "lock:drift") {
      void load();
    }
  }, [lastEvent]);

  const lockFiles = useMemo(() => new Set(locks.map((entry) => entry.file)), [locks]);
  const tree = useMemo(() => rules === null ? [] : buildRulesTree(rules, lockFiles, filter), [rules, lockFiles, filter]);
  const selectedNode = selected === null ? null : rules?.nodes[selected] ?? null;

  return (
    <section className="view">
      <ViewHeader
        title="Rules Tree Browser"
        subtitle=".fabric/agents.meta.json · L0/L1/L2 hierarchy · hash drift aware"
      />
      {error !== null ? <DriftIndicator kind="banner" severity="stale" message={error} /> : null}
      <div className="view-split">
        <div className="tree-panel">
          <div className="tree-filter">
            <input
              value={filter}
              onInput={(event) => setFilter(event.currentTarget.value)}
              placeholder="Filter by file, glob, priority, hash..."
              aria-label="Filter rules tree"
            />
            <button className="ghost-button" type="button" onClick={() => void load()}>Refresh</button>
          </div>
          <div className="status-line">
            <span>{rules === null ? "loading rules" : `${Object.keys(rules.nodes).length} nodes · rev ${rules.revision}`}</span>
            <span>{locks.length} human locks</span>
          </div>
          <div className="tree" role="tree" aria-label="Fabric rules tree">
            {tree.length > 0 ? tree.map((node) => (
              <TreeNode
                key={node.node.file}
                {...node}
                selected={node.node.file === selected}
                onSelect={setSelected}
              />
            )) : <div className="empty-card">No matching rules found.</div>}
          </div>
        </div>
        <aside className="detail-panel">
          <h3>Node Detail</h3>
          {selectedNode === null ? (
            <p className="muted">Select a rule node to inspect scope, dependencies, priority and hash.</p>
          ) : (
            <div className="kv">
              <Kv label="file" value={selectedNode.file} />
              <Kv label="scope" value={selectedNode.scope_glob} />
              <Kv label="priority" value={selectedNode.priority} />
              <Kv label="hash" value={selectedNode.hash} />
              <pre className="code">{selectedNode.deps.length > 0 ? selectedNode.deps.join("\n") : "no deps"}</pre>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

export function ViewHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="view-header">
      <div>
        <h1 className="view-title">{title}</h1>
        <p className="view-subtitle">{subtitle}</p>
      </div>
    </div>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv-row">
      <span className="kv-key">{label}</span>
      <span className="kv-value">{value}</span>
    </div>
  );
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

  const root: AgentsMetaNode = {
    file: `revision:${meta.revision}`,
    scope_glob: "**/*",
    deps: [],
    priority: "high",
    hash: meta.revision,
  };

  return [{
    node: root,
    level: 0,
    defaultExpanded: true,
    children: Array.from(groups.entries()).map(([group, nodes]) => ({
      node: {
        file: group,
        scope_glob: `${group}/**/*`,
        deps: [],
        priority: "medium",
        hash: `${nodes.length} nodes`,
      },
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
