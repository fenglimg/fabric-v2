import type { HumanLockEntry } from "@fabric/shared";

import { ApproveButton } from "./approve-button";
import { DriftIndicator } from "./drift-indicator";

export type DiffLine =
  | { kind: "ctx"; line: number; text: string }
  | { kind: "add"; line: number; text: string }
  | { kind: "del"; line: number; text: string };

export type LockCardProps = {
  entry: HumanLockEntry;
  currentHash?: string;
  diffStats?: { added: number; removed: number; bytes?: number };
  diffPreview?: DiffLine[];
  onApprove?: (entry: HumanLockEntry) => Promise<void>;
  busy?: boolean;
};

export function LockCard({
  entry,
  currentHash,
  diffStats,
  diffPreview = [],
  onApprove,
  busy = false,
}: LockCardProps) {
  const drift = currentHash !== undefined && currentHash !== entry.hash;
  const status = drift ? "drift" : "ok";
  const lineRange = `L${entry.start_line}-L${entry.end_line}`;

  return (
    <article
      className={`lock-card lock-${status} ${busy ? "is-busy" : ""}`}
      aria-label={`${entry.file} ${lineRange} ${drift ? "hash drift" : "confirmed"}`}
    >
      <header className="lock-head">
        <div className="lock-icon" aria-hidden="true">{drift ? "!" : "✓"}</div>
        <div className="lock-title">
          <strong>{entry.file}</strong>
          <span>{lineRange}</span>
        </div>
        <DriftIndicator kind="pill" severity={drift ? "drift" : "ok"} message={drift ? "drift" : "confirmed"} />
      </header>

      <div className="lock-body">
        <div className="hash-block">
          <HashRow label="locked hash" value={entry.hash} stale={drift} />
          <HashRow label="current hash" value={currentHash ?? "unavailable"} />
          <HashRow label="diff" value={formatDiff(diffStats, drift)} accent={drift} />
        </div>
        <div className="preview">
          <div className="preview-head">
            <span>{entry.file} · {lineRange}</span>
            <span>{drift ? "DRIFT" : "SYNC"}</span>
          </div>
          <pre className="preview-body">
            {diffPreview.length > 0
              ? diffPreview.map((line) => (
                  <span className={`line-${line.kind}`} key={`${line.kind}:${line.line}:${line.text}`}>
                    <span className="line-num">{line.line}</span>
                    {line.text}
                    {"\n"}
                  </span>
                ))
              : `${entry.file}\n${lineRange}\n${drift ? "Hash differs from protected region." : "Protected region is in sync."}`}
          </pre>
        </div>
      </div>

      <footer className="lock-foot">
        <span className="meta-line">protected region · {entry.end_line - entry.start_line + 1} lines</span>
        {drift && currentHash !== undefined && onApprove !== undefined ? (
          <ApproveButton
            variant="approve"
            state={busy ? "busy" : "idle"}
            ariaLabel={`Approve new hash for ${entry.file}`}
            onClick={() => onApprove(entry)}
          >
            Approve new hash
          </ApproveButton>
        ) : (
          <button className="action-button action-approve action-success" type="button" aria-disabled="true">
            ✓ Confirmed
          </button>
        )}
      </footer>
    </article>
  );
}

function HashRow({
  label,
  value,
  stale = false,
  accent = false,
}: {
  label: string;
  value: string;
  stale?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="hash-row">
      <span className="hash-key">{label}</span>
      <span className={`hash-value ${stale ? "is-stale" : ""} ${accent ? "is-accent" : ""}`}>{value}</span>
    </div>
  );
}

function formatDiff(
  diffStats: LockCardProps["diffStats"],
  drift: boolean,
): string {
  if (diffStats === undefined) {
    return drift ? "hash mismatch" : "no changes";
  }

  const bytes = diffStats.bytes === undefined ? "" : ` · ${diffStats.bytes} bytes`;
  return `+${diffStats.added} / -${diffStats.removed}${bytes}`;
}
