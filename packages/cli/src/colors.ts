import pc from "picocolors";
import stringWidth from "string-width";

type PaintFn = (value: string) => string;

// ISS-040: FORCE_COLOR is the dual of NO_COLOR. Exported for direct unit tests.
export function isColorEnabled(): boolean {
  // NO_COLOR (https://no-color.org) is an unconditional opt-out and takes
  // precedence over FORCE_COLOR when both are set.
  if (process.env.NO_COLOR) {
    return false;
  }
  // FORCE_COLOR forces color ON regardless of TTY (e.g. piping into a pager or
  // a CI runner that strips the TTY but renders ANSI). FORCE_COLOR=0 / "false"
  // is an explicit disable; any other value (incl. empty string) enables —
  // matching the de-facto supports-color convention.
  const force = process.env.FORCE_COLOR;
  if (force !== undefined) {
    return force !== "0" && force.toLowerCase() !== "false";
  }
  return Boolean(process.stdout.isTTY) && Boolean(process.stderr.isTTY);
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
    return isColorEnabled() ? paint.success("[ok] ✓") : "[ok]";
  },
  get warn(): string {
    return isColorEnabled() ? paint.warn("[warn] !") : "[warn]";
  },
  get error(): string {
    return isColorEnabled() ? paint.error("[error] x") : "[error]";
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
