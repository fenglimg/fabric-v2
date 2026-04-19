import type { AiLedgerEntry, LedgerEntry } from "@fabric/shared";
import { useState } from "preact/hooks";

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
    <article className={`timeline-entry timeline-${entry.source}`} aria-label={`${entry.source} intent ${entry.intent}`}>
      <div className={`dot-axis ${entry.source}`} aria-hidden="true" />
      <div className="timeline-head">
        <SourceBadge source={entry.source} />
        {isAi ? <span className="commit-hash">{entry.commit_sha ?? "working tree"}</span> : null}
        {!isAi ? <span className="commit-hash">parent {entry.parent_sha}</span> : null}
        {!isAi ? <span className="diff-badge">{entry.diff_stat}</span> : null}
        <time className="entry-time" dateTime={new Date(entry.ts).toISOString()}>{formatTime(entry.ts)}</time>
      </div>
      <h3 className="entry-title">{entry.intent}</h3>
      <div className="entry-meta">
        <span><span className="meta-key">paths</span> {entry.affected_paths.length}</span>
        {entry.affected_paths.slice(0, 3).map((path) => <span key={path}>{path}</span>)}
      </div>
      {!isAi && entry.annotation !== undefined ? (
        <div className="entry-body">{entry.annotation}</div>
      ) : null}
      {isAi && canAnnotate ? (
        <div className="entry-foot">
          <button className="ghost-button" type="button" onClick={() => setOpen((value) => !value)}>
            Annotate
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
          <label htmlFor={`annotate-${entry.id ?? entry.ts}`}>Human annotation</label>
          <input
            id={`annotate-${entry.id ?? entry.ts}`}
            className="annotate-input"
            value={annotation}
            onInput={(event) => setAnnotation(event.currentTarget.value)}
            placeholder="Explain review outcome or approval context..."
          />
          <ApproveButton variant="annotate" size="sm" onClick={submitAnnotation}>
            Save annotation
          </ApproveButton>
        </form>
      ) : null}
    </article>
  );
}

function formatTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ts));
}
