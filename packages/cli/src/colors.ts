import {
  isColorEnabled as themeColorEnabled,
  paint as themePaint,
  symbol as themeSymbol,
  type ThemeToken,
} from "@fenglimg/fabric-shared/theme";
import stringWidth from "string-width";

// ux-w2-5: the CLI colour surface is now a thin adapter over the SHARED theme
// (packages/shared/src/theme.ts) — the same palette the .cjs hooks render through
// (lib/theme.cjs, byte-locked by theme-parity.test.ts). The CLI no longer owns a
// private picocolors palette, so `fabric install` output and a SessionStart hook
// paint identical colours. Width helpers stay here (they need the CLI-only
// string-width dep). isColorEnabled re-reads env/TTY per call so NO_COLOR /
// FORCE_COLOR / a piped stdout are honoured at render time.

// ISS-040 / no-color.org: re-exported for direct unit tests; delegates to theme.
export function isColorEnabled(): boolean {
  return themeColorEnabled();
}

type PaintFn = (value: string) => string;

function tokenPainter(token: ThemeToken): PaintFn {
  return (value: string) => themePaint(token, value, isColorEnabled());
}

export const paint = {
  success: tokenPainter("success"),
  warn: tokenPainter("warn"),
  error: tokenPainter("error"),
  drift: tokenPainter("drift"),
  ai: tokenPainter("ai"),
  human: tokenPainter("human"),
  muted: tokenPainter("muted"),
} as const;

export const label = {
  get created(): string {
    return paint.success("Created");
  },
  get skipped(): string {
    return paint.muted("Skipped");
  },
  get next(): string {
    return paint.ai("Next");
  },
  get reason(): string {
    return paint.human("Reason");
  },
};

export const symbol = {
  get ok(): string {
    return themeSymbol("ok", isColorEnabled());
  },
  get warn(): string {
    return themeSymbol("warn", isColorEnabled());
  },
  get error(): string {
    return themeSymbol("error", isColorEnabled());
  },
};

export function displayWidth(value: string): number {
  return stringWidth(value);
}

export function padEnd(value: string, width: number, char: string = " "): string {
  const fill = char.length > 0 ? char : " ";
  let result = value;

  while (displayWidth(result) < width) {
    result += fill;
  }

  return result;
}
