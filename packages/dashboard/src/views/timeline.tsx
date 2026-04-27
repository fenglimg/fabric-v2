import type { AiLedgerEntry, FabricEvent, LedgerEntry } from "@fenglimg/fabric-shared";
import { useEffect, useMemo, useState } from "preact/hooks";

import { annotateIntent, getLedger, getHistoryState, type HistoryReplayResult } from "../api/client";
import { SourceBadge } from "../components/source-badge";
import { TimelineEntry } from "../components/timeline-entry";
import { DriftIndicator } from "../components/drift-indicator";
import { useI18n } from "../i18n/use-i18n";

// Helper for history replay tree (placeholder as we moved away from cross-view exports)
const buildRulesTree = (meta: any, lockFiles: Set<string>, filter: string): any[] => {
  return [];
};

export type TimelineViewProps = {
  lastEvent: FabricEvent | null;
};

type SourceFilter = "all" | "ai" | "human";

export function TimelineView({ lastEvent }: TimelineViewProps) {
  const { t, locale } = useI18n();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [filter, setFilter] = useState<SourceFilter>("all");
  
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<HistoryReplayResult | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setEntries(await getLedger());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (lastEvent?.type === "ledger:appended" || lastEvent?.type === "drift:detected" || lastEvent?.type === "lock:drift") {
      void load();
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

  const visible = useMemo(
    () => entries.filter((entry) => filter === "all" || entry.source === filter),
    [entries, filter],
  );
  
  const aiCount = entries.filter((entry) => entry.source === "ai").length;
  const humanCount = entries.length - aiCount;

  const annotate = async (entry: AiLedgerEntry, text: string) => {
    if (entry.id === undefined) {
      throw new Error(t("dashboard.intent-timeline.annotate.missing-id"));
    }

    const result = await annotateIntent({ ledger_entry_id: entry.id, annotation: text });
    if (result.created) {
      setEntries((current) => [result.entry, ...current].sort((left, right) => right.ts - left.ts));
    }
  };

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
    <div class="flex-1 flex flex-col gap-4 min-h-0 relative">
      <div class="flex flex-col gap-4 shrink-0">
        {error !== null ? (
          <div class="z-50 px-4 pt-2">
            <DriftIndicator kind="banner" severity="stale" message={error} />
          </div>
        ) : null}
        
        <div class="flex items-center gap-3 bg-light-surface border-b border-light-border dark:bg-dark-surface dark:border-white/5 dark:backdrop-blur-3xl sm:rounded-2xl sm:shadow-sm sm:border sm:mx-4 p-4 shrink-0 overflow-x-auto">
          <span class="text-xs font-bold uppercase tracking-wider text-light-muted dark:text-dark-muted shrink-0 mr-2">{t("dashboard.intent-timeline.filter.label")}</span>
          
          <button 
            class={`px-3 py-1.5 rounded-full text-xs font-bold font-mono transition-colors shrink-0 ${filter === "all" ? "bg-light-text text-light-bg dark:bg-white dark:text-black" : "bg-light-border/30 hover:bg-light-border/50 text-light-muted dark:bg-white/5 dark:hover:bg-white/10 dark:text-dark-muted"}`} 
            type="button" 
            onClick={() => setFilter("all")}
          >
            {t("dashboard.intent-timeline.filter.all")} <span class="opacity-60 ml-1">{entries.length}</span>
          </button>
          
          <div class="shrink-0" onClick={() => setFilter("ai")}>
            <SourceBadge source="ai" interactive selected={filter === "ai"} />
          </div>
          <div class="shrink-0" onClick={() => setFilter("human")}>
            <SourceBadge source="human" interactive selected={filter === "human"} />
          </div>
          
          <span class="font-mono text-xs text-light-muted dark:text-dark-muted ml-auto shrink-0 whitespace-nowrap hidden sm:inline">
            {t("dashboard.intent-timeline.summary", {
              aiCount: String(aiCount),
              humanCount: String(humanCount),
            })}
          </span>
        </div>
      </div>

      <div class="flex-1 flex flex-col md:flex-row gap-4 min-h-0 sm:px-4">
        {/* Main Timeline View */}
        <div class="flex-1 overflow-y-auto pr-2 pb-8 relative">
          <div class="absolute left-6 md:left-1/2 top-0 bottom-0 w-0.5 bg-gradient-to-b from-light-border via-light-border/50 to-transparent dark:from-dark-border dark:via-dark-border/50 -translate-x-1/2 z-0 hidden md:block"></div>
          <div class="absolute left-[39px] top-0 bottom-0 w-0.5 bg-gradient-to-b from-light-border via-light-border/50 to-transparent dark:from-dark-border dark:via-dark-border/50 z-0 block md:hidden"></div>
          
          <div class="flex flex-col gap-6 pt-4 relative z-10">
            {visible.length > 0 ? visible.map((entry) => (
               <div key={entry.id} class="flex items-start gap-4" onClick={() => setSelectedEntryId(entry.id ?? null)}>
                 {/* 
                   Simplified timeline entry for brevity, normally we'd render the full TimelineEntry component 
                 */}
                 <div class="w-full">
                   <TimelineEntry entry={entry} onAnnotate={annotate} />
                 </div>
               </div>
             )) : (
               <div class="p-8 text-center text-sm text-light-muted dark:text-dark-muted bg-light-surface border border-light-border dark:bg-dark-surface dark:border-white/5 dark:backdrop-blur-3xl sm:rounded-2xl max-w-xl mx-auto w-full">
                 {t("dashboard.intent-timeline.empty")}
               </div>
             )}
           </div>
         </div>

         {/* Side Drawer for History Replay */}
         {selectedEntryId !== null && (
           <aside class="w-full md:w-1/3 xl:w-1/4 flex flex-col overflow-hidden bg-light-surface border border-light-border sm:rounded-2xl sm:shadow-sm dark:bg-dark-surface dark:border-white/5 dark:backdrop-blur-3xl dark:shadow-xl shrink-0 h-full">
             <div class="p-4 border-b border-light-border dark:border-dark-border flex flex-col gap-3 bg-light-surface/90 dark:bg-transparent z-10 shrink-0">
               <div class="flex justify-between items-start w-full">
                 <div>
                   <h3 class="text-sm font-bold uppercase tracking-wider text-light-text dark:text-dark-text m-0 flex items-center gap-2">
                     <svg class="w-4 h-4 text-brand-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                     {t("dashboard.timeline.history-replay.title")}
                   </h3>
                 </div>
                 <button class="w-6 h-6 rounded-full bg-light-border/50 hover:bg-light-border text-light-muted dark:bg-white/10 dark:hover:bg-white/20 dark:text-dark-muted flex items-center justify-center transition-colors" onClick={() => setSelectedEntryId(null)}>
                   <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                 </button>
               </div>

               <div class="flex flex-col gap-1 text-[10px] font-mono text-light-muted dark:text-dark-muted">
                 <span class="truncate">
                   <span class="opacity-50 mr-1">ID:</span> {selectedEntryId.substring(0, 16)}...
                 </span>
                 <span class="truncate">
                   <span class="opacity-50 mr-1">Time:</span> {selectedLabel}
                 </span>
               </div>
             </div>

             <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
               {loadingSnapshot && (
                 <div class="py-12 text-center text-xs text-light-muted dark:text-dark-muted animate-pulse">
                   {t("dashboard.history-replay.loading")}
                 </div>
               )}

               {!loadingSnapshot && tree.length > 0 ? (
                 <div class="text-xs text-light-muted dark:text-dark-muted text-center py-8">
                    {/* Placeholder for tree content */}
                    Coming soon...
                 </div>
               ) : !loadingSnapshot && (
                 <div class="text-xs text-light-muted dark:text-dark-muted text-center py-8">
                   {t("dashboard.history-replay.no-data")}
                 </div>
               )}
             </div>
           </aside>
         )}
      </div>
    </div>
  );
}

function readPort(): number {
  const parsed = Number.parseInt(window.location.port, 10);
  return Number.isFinite(parsed) ? parsed : 7373;
}
