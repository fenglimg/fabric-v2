import pc from "picocolors";
import stringWidth from "string-width";

type PaintFn = (value: string) => string;

function isColorEnabled(): boolean {
  return !process.env.NO_COLOR && Boolean(process.stdout.isTTY) && Boolean(process.stderr.isTTY);
}

function colorize(painter: PaintFn): PaintFn {
  return (value: string) => (isColorEnabled() ? painter(value) : value);
}

export const paint = {
  success: colorize(pc.green),
  warn: colorize(pc.yellow),
  error: colorize(pc.red),
  drift: colorize(pc.magenta),
  ai: colorize(pc.blue),
  human: colorize(pc.cyan),
  muted: colorize(pc.dim),
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
    return isColorEnabled() ? paint.success("✓") : "[ok]";
  },
  get warn(): string {
    return isColorEnabled() ? paint.warn("!") : "[warn]";
  },
  get error(): string {
    return isColorEnabled() ? paint.error("x") : "[error]";
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
