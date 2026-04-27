import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

import { useI18n } from "../i18n/use-i18n";

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
  const { t } = useI18n();
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

  const baseStyles = "inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-200 border";
  const sizeStyles = size === "sm" ? "px-3 py-1.5 text-xs min-h-[32px]" : "px-4 py-2 text-sm min-h-[40px]";
  
  let variantStyles = "";
  if (effectiveState === "success") {
    variantStyles = "bg-green-500/10 border-green-500/30 text-green-600 dark:bg-green-500/20 dark:border-green-500/30 dark:text-green-400 cursor-default";
  } else if (effectiveState === "error") {
    variantStyles = "bg-red-500/10 border-red-500 text-red-600 dark:bg-red-500/20 dark:border-red-500 dark:text-red-400 cursor-pointer hover:bg-red-500/20 dark:hover:bg-red-500/30";
  } else if (variant === "approve") {
    variantStyles = "bg-brand-accent border-transparent text-white hover:bg-brand-accent/90 dark:bg-purple-600 dark:hover:bg-purple-500 cursor-pointer shadow-sm";
  } else {
    // annotate
    variantStyles = "bg-light-surface border-light-border text-light-text hover:bg-light-border/50 dark:bg-white/5 dark:border-dark-border dark:text-dark-text dark:hover:bg-white/10 cursor-pointer shadow-sm";
  }

  const busyStyles = busy ? "opacity-70 cursor-not-allowed transform-none" : "active:scale-[0.98]";

  return (
    <button
      type="button"
      class={`${baseStyles} ${sizeStyles} ${variantStyles} ${busyStyles}`}
      aria-label={ariaLabel}
      aria-busy={busy}
      aria-disabled={busy}
      onClick={handleClick}
    >
      {busy ? <span class="w-3.5 h-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" aria-hidden="true" /> : null}
      {effectiveState === "success" ? <span aria-hidden="true">✓</span> : null}
      {effectiveState === "error" ? t("dashboard.approve-button.retry") : children}
    </button>
  );
}