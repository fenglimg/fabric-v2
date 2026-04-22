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

  return (
    <article
      className={`timeline-entry timeline-${entry.source}`}
      aria-label={t("dashboard.timeline-entry.aria-label", {
        source: t(`dashboard.source.${entry.source}`),
        intent: entry.intent,
      })}
    >
      <div className={`dot-axis ${entry.source}`} aria-hidden="true" />
      <div className="timeline-head">
        <SourceBadge source={entry.source} />
        {isAi ? <span className="commit-hash">{entry.commit_sha ?? t("dashboard.timeline-entry.working-tree")}</span> : null}
        {!isAi ? <span className="commit-hash">{t("dashboard.timeline-entry.parent", { parent: entry.parent_sha })}</span> : null}
        {!isAi ? <span className="diff-badge">{entry.diff_stat}</span> : null}
        <time className="entry-time" dateTime={new Date(entry.ts).toISOString()}>{formatTime(entry.ts, locale)}</time>
      </div>
      <h3 className="entry-title">{entry.intent}</h3>
      <div className="entry-meta">
        <span><span className="meta-key">{t("dashboard.timeline-entry.paths")}</span> {entry.affected_paths.length}</span>
        {entry.affected_paths.slice(0, 3).map((path) => <span key={path}>{path}</span>)}
      </div>
      {!isAi && entry.annotation !== undefined ? (
        <div className="entry-body">{entry.annotation}</div>
      ) : null}
      {isAi && canAnnotate ? (
        <div className="entry-foot">
          <button className="ghost-button" type="button" onClick={() => setOpen((value) => !value)}>
            {t("dashboard.timeline-entry.annotate")}
          </button>
        </div>
      ) : null}
      {open && isAi ? (
        <form
          className="annotate-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitAnnotation();
          }}
        >
          <label htmlFor={`annotate-${entry.id ?? entry.ts}`}>{t("dashboard.timeline-entry.annotation-label")}</label>
          <input
            id={`annotate-${entry.id ?? entry.ts}`}
            className="annotate-input"
            value={annotation}
            onInput={(event) => setAnnotation(event.currentTarget.value)}
            placeholder={t("dashboard.timeline-entry.annotation-placeholder")}
          />
          <ApproveButton variant="annotate" size="sm" onClick={submitAnnotation}>{t("dashboard.timeline-entry.annotation-save")}</ApproveButton>
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
