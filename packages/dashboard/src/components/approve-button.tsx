import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

export type ApproveButtonProps = {
  variant: "approve" | "annotate";
  state?: "idle" | "busy" | "success" | "error";
  size?: "sm" | "md";
  onClick: () => Promise<void>;
  children: ComponentChildren;
  ariaLabel?: string;
};

type ButtonState = NonNullable<ApproveButtonProps["state"]>;

export function ApproveButton({
  variant,
  state = "idle",
  size = "md",
  onClick,
  children,
  ariaLabel,
}: ApproveButtonProps) {
  const [internalState, setInternalState] = useState<ButtonState>(state);
  const effectiveState = state === "idle" ? internalState : state;
  const busy = effectiveState === "busy";

  const handleClick = async () => {
    if (busy) {
      return;
    }

    setInternalState("busy");
    try {
      await onClick();
      setInternalState("success");
      window.setTimeout(() => setInternalState("idle"), 900);
    } catch {
      setInternalState("error");
      window.setTimeout(() => setInternalState("idle"), 1400);
    }
  };

  return (
    <button
      type="button"
      className={`action-button action-${variant} action-${size} action-${effectiveState}`}
      aria-label={ariaLabel}
      aria-busy={busy}
      aria-disabled={busy}
      onClick={handleClick}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      {effectiveState === "success" ? <span aria-hidden="true">✓</span> : null}
      {effectiveState === "error" ? "Retry" : children}
    </button>
  );
}
