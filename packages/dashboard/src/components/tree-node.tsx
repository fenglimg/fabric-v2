import type { AgentsMetaNode } from "@fenglimg/fabric-shared";
import { useState } from "preact/hooks";

import { useI18n } from "../i18n/use-i18n";
import { DriftIndicator } from "./drift-indicator";

export type TreeNodeProps = {
  node: AgentsMetaNode;
  level: 0 | 1 | 2 | 3;
  selected?: boolean;
  onSelect?: (path: string) => void;
  humanLockedNearby?: boolean;
  staleReason?: "hash-mismatch" | "orphan" | null;
  defaultExpanded?: boolean;
  readOnly?: boolean;
  children?: TreeNodeProps[];
};

export function TreeNode({
  node,
  level,
  selected = false,
  onSelect,
  humanLockedNearby = false,
  staleReason = null,
  defaultExpanded = false,
  readOnly = false,
  children = [],
}: TreeNodeProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = children.length > 0;
  const path = node.file;
  const staleSeverity = staleReason === null ? "ok" : staleReason === "orphan" ? "orphan" : "stale";

  const handleToggle = () => {
    if (readOnly) {
      return;
    }

    if (hasChildren) {
      setExpanded((value) => !value);
    }
    onSelect?.(path);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (readOnly) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleToggle();
    }
    if (event.key === "ArrowRight" && hasChildren) {
      setExpanded(true);
    }
    if (event.key === "ArrowLeft" && hasChildren) {
      setExpanded(false);
    }
  };

  return (
    <div className={`tree-node-group tree-level-${level}`}>
      <div
        className={[
          "tree-node",
          selected ? "is-selected" : "",
          expanded ? "is-expanded" : "",
          humanLockedNearby ? "is-locked" : "",
          staleReason !== null ? "is-stale" : "",
          readOnly ? "is-readonly" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="treeitem"
        aria-expanded={hasChildren ? expanded : undefined}
        aria-level={level + 1}
        aria-readonly={readOnly || undefined}
        tabIndex={readOnly ? -1 : 0}
        onClick={readOnly ? undefined : handleToggle}
        onKeyDown={readOnly ? undefined : handleKeyDown}
      >
        <span className="tree-caret" aria-hidden="true">{hasChildren ? "›" : "·"}</span>
        <span className="tree-icon" aria-hidden="true">{level === 0 ? "F" : level === 1 ? "D" : "R"}</span>
        <span className="tree-label">{path}</span>
        {humanLockedNearby ? <span className="badge badge-locked">{t("dashboard.tree-node.locked")}</span> : null}
        {staleReason !== null ? (
          <DriftIndicator kind="pill" severity={staleSeverity} message={t(`dashboard.tree-node.stale.${staleReason}`)} />
        ) : null}
        <span className="tree-meta">
          <span className="badge badge-level">L{level}</span>
          <span className="tree-hash">{shortHash(node.hash)}</span>
        </span>
      </div>
      {hasChildren && expanded ? (
        <div className="tree-children" role="group">
          {children.map((child) => (
            <TreeNode key={`${child.node.file}:${child.level}`} {...child} onSelect={onSelect} readOnly={readOnly} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function shortHash(hash: string): string {
  return hash.length > 18 ? `${hash.slice(0, 12)}…` : hash;
}
