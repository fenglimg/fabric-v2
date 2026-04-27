import type { AiLedgerEntry, LedgerEntry } from "@fenglimg/fabric-shared";
import { useState } from "preact/hooks";

import { useI18n } from "../i18n/use-i18n";
import { ApproveButton } from "./approve-button";
import { SourceBadge } from "./source-badge";

export type TimelineEntryProps = {
  entry: LedgerEntry;
  onAnnotate?: (entry: AiLedgerEntry, text: string) => Promise<void>;
  expanded?: boolean;
  readOnly?: boolean;
};

export function TimelineEntry({
  entry,
  onAnnotate,
  expanded = false,
  readOnly = false,
}: TimelineEntryProps) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(expanded);
  const [annotation, setAnnotation] = useState("");
  const isAi = entry.source === "ai";
  const canAnnotate = !readOnly && isAi && onAnnotate !== undefined && entry.id !== undefined;

  const submitAnnotation = async () => {
    const text = annotation.trim();
    if (!isAi || onAnnotate === undefined || text.length === 0) {
      return;
    }

    await onAnnotate(entry, text);
    setAnnotation("");
    setOpen(false);
  };

  const borderColor = isAi ? "border-brand-accent/30 dark:border-purple-500/30" : "border-teal-500/30 dark:border-teal-500/30";

  return (
    <article
      class={`p-5 rounded-2xl border bg-light-surface dark:bg-dark-surface dark:backdrop-blur-xl shadow-sm ${borderColor} flex flex-col gap-3 relative`}
      aria-label={t("dashboard.timeline-entry.aria-label", {
        source: t(`dashboard.source.${entry.source}`),
        intent: entry.intent,
      })}
    >
      <div class="flex flex-wrap items-center gap-3">
        <SourceBadge source={entry.source} />
        {isAi ? <span class="font-mono text-[10px] px-2 py-1 rounded-md bg-light-border/50 text-light-muted dark:bg-white/10 dark:text-dark-muted border border-light-border dark:border-dark-border">{entry.commit_sha ? entry.commit_sha.substring(0, 8) : t("dashboard.timeline-entry.working-tree")}</span> : null}
        {!isAi ? <span class="font-mono text-[10px] px-2 py-1 rounded-md bg-light-border/50 text-light-muted dark:bg-white/10 dark:text-dark-muted border border-light-border dark:border-dark-border">{t("dashboard.timeline-entry.parent", { parent: entry.parent_sha ? entry.parent_sha.substring(0,8) : "" })}</span> : null}
        {!isAi ? <span class="font-mono text-[10px] px-2 py-1 rounded-full bg-light-border/30 text-light-muted dark:bg-black/20 dark:text-dark-muted border border-light-border dark:border-dark-border">{entry.diff_stat}</span> : null}
        <time class="ml-auto font-mono text-[10px] text-light-muted dark:text-dark-muted opacity-60 tracking-wider" dateTime={new Date(entry.ts).toISOString()}>{formatTime(entry.ts, locale)}</time>
      </div>
      
      <h3 class="text-base font-medium text-light-text dark:text-white/90 leading-tight m-0">{entry.intent}</h3>
      
      <div class="flex flex-wrap gap-2 text-[10px] font-mono text-light-muted dark:text-dark-muted mt-1">
        <span class="flex items-center gap-1 opacity-70"><svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg> {entry.affected_paths.length} {t("dashboard.timeline-entry.paths")}</span>
        {entry.affected_paths.slice(0, 3).map((path) => (
          <span key={path} class="truncate max-w-[120px] bg-light-border/20 dark:bg-white/5 px-1.5 py-0.5 rounded">{path.split('/').pop()}</span>
        ))}
        {entry.affected_paths.length > 3 && <span class="opacity-50">...</span>}
      </div>
      
      {!isAi && entry.annotation !== undefined ? (
        <div class="mt-2 p-3 rounded-lg bg-teal-500/5 border border-teal-500/10 dark:bg-teal-500/10 dark:border-teal-500/20 text-sm text-light-text dark:text-dark-text leading-relaxed">
          <div class="text-[10px] font-bold text-teal-600 dark:text-teal-400 uppercase tracking-widest mb-1">{t("dashboard.timeline-entry.annotation-label")}</div>
          {entry.annotation}
        </div>
      ) : null}
      
      {isAi && canAnnotate ? (
        <div class="mt-1 flex justify-end">
          <button class="text-[10px] font-bold uppercase tracking-widest text-light-muted hover:text-light-text dark:text-dark-muted dark:hover:text-white/80 transition-colors flex items-center gap-1 px-2 py-1 rounded hover:bg-light-border/50 dark:hover:bg-white/10" type="button" onClick={(e) => { e.stopPropagation(); setOpen((value) => !value); }}>
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
            {t("dashboard.timeline-entry.annotate")}
          </button>
        </div>
      ) : null}
      
      {open && isAi ? (
        <form
          class="mt-3 flex flex-col gap-3 p-4 rounded-xl bg-light-border/30 border border-light-border dark:bg-black/20 dark:border-dark-border"
          onClick={(e) => e.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            void submitAnnotation();
          }}
        >
          <label class="text-[10px] font-bold text-light-muted dark:text-dark-muted uppercase tracking-widest" htmlFor={`annotate-${entry.id ?? entry.ts}`}>{t("dashboard.timeline-entry.annotation-label")}</label>
          <input
            id={`annotate-${entry.id ?? entry.ts}`}
            class="px-3 py-2 rounded-lg text-sm bg-light-surface border border-light-border text-light-text dark:bg-dark-surface dark:border-dark-border dark:text-dark-text placeholder:text-light-muted dark:placeholder:text-dark-muted focus:outline-none focus:ring-2 focus:ring-brand-accent/50 transition-shadow w-full"
            value={annotation}
            onInput={(event) => setAnnotation(event.currentTarget.value)}
            placeholder={t("dashboard.timeline-entry.annotation-placeholder")}
          />
          <div class="flex justify-end gap-2 mt-1">
            <ApproveButton variant="annotate" size="sm" onClick={submitAnnotation}>{t("dashboard.timeline-entry.annotation-save")}</ApproveButton>
          </div>
        </form>
      ) : null}
    </article>
  );
}

function formatTime(ts: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ts));
}