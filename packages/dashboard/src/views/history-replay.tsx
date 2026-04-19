import type { FabricEvent, LedgerEntry } from "@fenglimg/fabric-shared";
import { useEffect, useMemo, useState } from "preact/hooks";

import { getHistoryState, getLedger, type HistoryReplayResult } from "../api/client";
import { DriftIndicator, TimelineEntry, TreeNode } from "../components";
import { useI18n } from "../i18n/use-i18n";
import { buildRulesTree, ViewHeader } from "./rules-tree";

export type HistoryReplayViewProps = {
  lastEvent: FabricEvent | null;
};

export function HistoryReplayView({ lastEvent }: HistoryReplayViewProps) {
  const { locale, t } = useI18n();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<HistoryReplayResult | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLedger = async () => {
    try {
      const nextEntries = (await getLedger()).sort((left, right) => left.ts - right.ts);
      setEntries(nextEntries);
      setSelectedEntryId((current) => {
        if (nextEntries.length === 0) {
          return null;
        }

        if (current !== null && nextEntries.some((entry) => entry.id === current)) {
          return current;
        }

        return nextEntries.at(-1)?.id ?? null;
      });
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  };

  useEffect(() => {
    void loadLedger();
  }, []);

  useEffect(() => {
    if (lastEvent?.type === "ledger:appended") {
      void loadLedger();
    }
  }, [lastEvent]);

  useEffect(() => {
    if (selectedEntryId === null) {
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    setLoadingSnapshot(true);

    void getHistoryState({ ledgerId: selectedEntryId })
      .then((result) => {
        if (!cancelled) {
          setSnapshot(result);
          setError(null);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setSnapshot(null);
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingSnapshot(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedEntryId]);

  const selectedIndex = useMemo(
    () => entries.findIndex((entry) => entry.id === selectedEntryId),
    [entries, selectedEntryId],
  );
  const selectedEntry = selectedIndex >= 0 ? entries[selectedIndex] ?? null : null;
  const selectedLabel = selectedEntry === null
    ? t("dashboard.history-replay.selected.none")
    : new Date(selectedEntry.ts).toLocaleString(locale);
  const tree = useMemo(
    () => snapshot === null ? [] : buildRulesTree(snapshot.meta, new Set<string>(), ""),
    [snapshot],
  );

  return (
    <section className="view">
      <ViewHeader
        title={t("dashboard.history-replay.title")}
        subtitle={t("dashboard.history-replay.subtitle")}
      />
      {error !== null ? <DriftIndicator kind="banner" severity="stale" message={error} /> : null}
      <div className="filter-bar history-toolbar">
        <span className="filter-label">{t("dashboard.history-replay.toolbar.scrub")}</span>
        <input
          className="history-slider"
          type="range"
          min="0"
          max={Math.max(entries.length - 1, 0)}
          value={selectedIndex >= 0 ? selectedIndex : 0}
          disabled={entries.length === 0}
          onInput={(event) => {
            const nextIndex = Number.parseInt(event.currentTarget.value, 10);
            const nextEntry = entries[nextIndex];
            if (nextEntry?.id !== undefined) {
              setSelectedEntryId(nextEntry.id);
            }
          }}
        />
        <span className="filter-date">{selectedLabel}</span>
        <button
          className="ghost-button"
          type="button"
          disabled={entries.length === 0}
          onClick={() => setSelectedEntryId(entries.at(-1)?.id ?? null)}
        >
          {t("dashboard.history-replay.toolbar.latest")}
        </button>
      </div>
      <div className="view-split history-layout">
        <div className="tree-panel history-timeline-panel">
          <div className="status-line">
            <span>{t("dashboard.history-replay.status.replay-points", { count: String(entries.length) })}</span>
            <span>{t("dashboard.history-replay.status.entries-applied", { count: String(snapshot?.metadata.replayed_count ?? 0) })}</span>
          </div>
          <div className="history-timeline-list">
            {entries.length > 0 ? [...entries].reverse().map((entry) => (
              <div
                key={entry.id ?? `${entry.source}:${entry.ts}:${entry.intent}`}
                className={`history-timeline-item ${entry.id === selectedEntryId ? "selected" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedEntryId(entry.id ?? null)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedEntryId(entry.id ?? null);
                  }
                }}
                >
                <TimelineEntry entry={entry} readOnly />
              </div>
            )) : <div className="empty-card">{t("dashboard.history-replay.empty.entries")}</div>}
          </div>
        </div>
        <div className="tree-panel">
          <div className="tree-filter history-state-head">
            <div>
              <div className="history-state-title">{t("dashboard.history-replay.state.title", { label: selectedLabel })}</div>
              <div className="meta-line">
                {t("dashboard.history-replay.state.meta", {
                  ledgerId: snapshot?.metadata.at_ledger_id ?? t("dashboard.history-replay.meta.na"),
                  commit: snapshot?.metadata.at_commit ?? t("dashboard.history-replay.meta.not-available"),
                  mode: snapshot?.metadata.mode ?? t("dashboard.history-replay.meta.pending"),
                })}
              </div>
            </div>
          </div>
          <div className="status-line">
            <span>
              {snapshot === null
                ? t("dashboard.history-replay.status.loading")
                : t("dashboard.history-replay.status.nodes", { count: String(Object.keys(snapshot.meta.nodes).length) })}
            </span>
            <span>{snapshot?.meta.revision ?? t("dashboard.history-replay.status.unknown-revision")}</span>
          </div>
          <div className="tree" role="tree" aria-label={t("dashboard.history-replay.tree.aria-label")}>
            {loadingSnapshot ? <div className="empty-card">{t("dashboard.history-replay.empty.loading")}</div> : null}
            {!loadingSnapshot && tree.length > 0 ? tree.map((node) => (
              <TreeNode key={node.node.file} {...node} readOnly />
            )) : null}
            {!loadingSnapshot && tree.length === 0 ? <div className="empty-card">{t("dashboard.history-replay.empty.select")}</div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
