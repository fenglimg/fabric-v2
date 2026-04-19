export type DriftIndicatorProps = {
  kind: "dot" | "pill" | "banner";
  severity: "drift" | "stale" | "orphan" | "locked" | "ok";
  message?: string;
  diffStats?: { added: number; removed: number };
};

const defaultMessage: Record<DriftIndicatorProps["severity"], string> = {
  ok: "confirmed",
  drift: "hash drift",
  stale: "stale",
  orphan: "orphan",
  locked: "attention",
};

export function DriftIndicator({ kind, severity, message, diffStats }: DriftIndicatorProps) {
  if (severity === "ok" && kind === "dot") {
    return null;
  }

  const label = message ?? defaultMessage[severity];
  const stats =
    diffStats === undefined ? "" : ` +${diffStats.added} / -${diffStats.removed}`;
  const className = `drift-indicator drift-${kind} drift-${severity}`;

  if (kind === "dot") {
    return <span className={className} aria-label={label} />;
  }

  if (kind === "banner") {
    return (
      <div className={className} role="status">
        <span aria-hidden="true">!</span>
        <span>{label}{stats}</span>
      </div>
    );
  }

  return (
    <span className={className}>
      <span aria-hidden="true">{severity === "ok" ? "✓" : "!"}</span>
      <span>{label}{stats}</span>
    </span>
  );
}
