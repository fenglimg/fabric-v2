import type { HumanLockEntry } from "@fenglimg/fabric-shared";

import { useI18n } from "../i18n/use-i18n";
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
  const { t } = useI18n();
  const drift = currentHash !== undefined && currentHash !== entry.hash;
  const status = drift ? "drift" : "ok";
  const statusLabel = drift ? t("dashboard.lock-card.status.drift") : t("dashboard.lock-card.status.confirmed");
  const lineRange = `L${entry.start_line}-L${entry.end_line}`;

  return (
    <article
      className={`lock-card lock-${status} ${busy ? "is-busy" : ""}`}
      aria-label={t("dashboard.lock-card.aria-label", { file: entry.file, lineRange, status: statusLabel })}
    >
      <header className="lock-head">
        <div className="lock-icon" aria-hidden="true">{drift ? "!" : "✓"}</div>
        <div className="lock-title">
          <strong>{entry.file}</strong>
          <span>{lineRange}</span>
        </div>
        <DriftIndicator kind="pill" severity={drift ? "drift" : "ok"} message={statusLabel} />
      </header>

      <div className="lock-body">
        <div className="hash-block">
          <HashRow label={t("dashboard.lock-card.hash.locked")} value={entry.hash} stale={drift} />
          <HashRow label={t("dashboard.lock-card.hash.current")} value={currentHash ?? t("dashboard.history-replay.meta.not-available")} />
          <HashRow label={t("dashboard.lock-card.hash.diff")} value={formatDiff(diffStats, drift, t)} accent={drift} />
        </div>
        <div className="preview">
          <div className="preview-head">
            <span>{entry.file} · {lineRange}</span>
            <span>{drift ? t("dashboard.lock-card.preview.drift") : t("dashboard.lock-card.preview.sync")}</span>
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
              : `${entry.file}\n${lineRange}\n${drift ? t("dashboard.lock-card.preview.drift-detail") : t("dashboard.lock-card.preview.sync-detail")}`}
          </pre>
        </div>
      </div>

      <footer className="lock-foot">
        <span className="meta-line">
          {t("dashboard.lock-card.footer.region", { count: String(entry.end_line - entry.start_line + 1) })}
        </span>
        {drift && currentHash !== undefined && onApprove !== undefined ? (
          <ApproveButton
            variant="approve"
            state={busy ? "busy" : "idle"}
            ariaLabel={t("dashboard.lock-card.button.approve")}
            onClick={() => onApprove(entry)}
          >
            {t("dashboard.lock-card.button.approve")}
          </ApproveButton>
        ) : (
          <button className="action-button action-approve action-success" type="button" aria-disabled="true">
            ✓ {t("dashboard.lock-card.button.confirmed")}
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
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (diffStats === undefined) {
    return drift ? t("dashboard.lock-card.diff.hash-mismatch") : t("dashboard.lock-card.diff.no-changes");
  }

  if (diffStats.bytes !== undefined) {
    return t("dashboard.lock-card.diff.with-bytes", {
      added: String(diffStats.added),
      removed: String(diffStats.removed),
      bytes: String(diffStats.bytes),
    });
  }

  return t("dashboard.lock-card.diff.without-bytes", {
    added: String(diffStats.added),
    removed: String(diffStats.removed),
  });
}
