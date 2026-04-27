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

  const getIndentClasses = () => {
    switch (level) {
      case 0: return "";
      case 1: return "ml-4";
      case 2: return "ml-8";
      case 3: return "ml-12";
      default: return "";
    }
  };

  const getThemeClasses = () => {
    if (selected) {
      return "bg-brand-accent/10 border border-brand-accent/20 dark:bg-purple-500/10 dark:border-purple-500/20 dark:shadow-[inset_0_0_12px_rgba(168,85,247,0.05)]";
    }
    if (!readOnly) {
      return "hover:bg-light-border/30 dark:hover:bg-white/5 border border-transparent";
    }
    return "border border-transparent";
  };
  
  const getLevelLabel = () => {
    switch (level) {
      case 0: return { label: "L0", class: "text-light-muted dark:text-dark-muted bg-light-border/50 dark:bg-white/10" };
      case 1: return { label: "L1", class: "text-brand-accent dark:text-purple-400 bg-brand-accent/20 dark:bg-purple-500/20" };
      case 2: return { label: "L2", class: "text-brand-warning dark:text-amber-400 bg-brand-warning/10 dark:bg-amber-500/10" };
      case 3: return { label: "L3", class: "text-slate-500 dark:text-slate-400 bg-slate-500/10 dark:bg-slate-500/10" };
      default: return { label: "Lx", class: "" };
    }
  };
  const lvl = getLevelLabel();

  return (
    <div class="flex flex-col mb-0.5">
      <div
        class={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-sm transition-all duration-200 ${getIndentClasses()} ${getThemeClasses()}`}
        role="treeitem"
        aria-expanded={hasChildren ? expanded : undefined}
        aria-level={level + 1}
        aria-readonly={readOnly || undefined}
        tabIndex={readOnly ? -1 : 0}
        onClick={readOnly ? undefined : handleToggle}
        onKeyDown={readOnly ? undefined : handleKeyDown}
      >
        <div class="flex items-center gap-2 overflow-hidden">
          <span class={`w-4 h-4 flex items-center justify-center text-light-muted dark:text-dark-muted transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden="true">
            {hasChildren ? (
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
            ) : "•"}
          </span>
          <span class={`text-[10px] font-bold px-1.5 py-0.5 rounded ${lvl.class}`}>{lvl.label}</span>
          <span class={`font-mono truncate ${selected ? "font-bold text-brand-accent dark:text-purple-100" : "text-light-muted dark:text-dark-muted"} ${level === 0 ? "font-medium text-light-text dark:text-white/90" : ""}`}>
            {path}
          </span>
          {humanLockedNearby ? <span class="text-[10px] bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">{t("dashboard.tree-node.locked")}</span> : null}
          {staleReason !== null ? (
            <div class="ml-2 flex items-center">
              <DriftIndicator kind="pill" severity={staleSeverity} message={t(`dashboard.tree-node.stale.${staleReason}`)} />
            </div>
          ) : null}
        </div>
        <div class="flex items-center gap-2 shrink-0 ml-4 hidden sm:flex">
          <span class="font-mono text-xs text-light-muted dark:text-dark-muted opacity-50">{shortHash(node.hash)}</span>
        </div>
      </div>
      
      {hasChildren && expanded ? (
        <div class="flex flex-col mt-0.5 relative" role="group">
          {/* Vertical indent guide lines */}
          <div class={`absolute top-0 bottom-0 left-[22px] ${level === 0 ? "" : level === 1 ? "ml-4" : level === 2 ? "ml-8" : "ml-12"} w-px bg-light-border/50 dark:bg-dark-border/50 z-0`}></div>
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