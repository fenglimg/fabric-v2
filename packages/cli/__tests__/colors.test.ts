import { afterEach, describe, expect, it } from "vitest";

const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const stderrDescriptor = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
const originalNoColor = process.env.NO_COLOR;

afterEach(() => {
  restoreDescriptor(process.stdout, "isTTY", stdoutDescriptor);
  restoreDescriptor(process.stderr, "isTTY", stderrDescriptor);

  if (originalNoColor === undefined) {
    delete process.env.NO_COLOR;
  } else {
    process.env.NO_COLOR = originalNoColor;
  }
});

describe("cli colors", () => {
  it("exports the expected semantic paint keys", async () => {
    const { paint } = await import("../src/colors.ts");

    expect(Object.keys(paint)).toEqual(["success", "warn", "error", "drift", "ai", "human", "muted"]);
  });

  it("disables ANSI color when NO_COLOR=1", async () => {
    process.env.NO_COLOR = "1";
    setIsTTY(false);

    const { paint, label, symbol } = await import("../src/colors.ts");

    expect(paint.success("ok")).toBe("ok");
    expect(label.created).toBe("Created");
    expect(symbol.ok).toBe("[ok]");
    expect(symbol.warn).toBe("[warn]");
    expect(symbol.error).toBe("[error]");
  });

  it("disables ANSI color when output is not a TTY", async () => {
    delete process.env.NO_COLOR;
    setIsTTY(false);

    const { paint, symbol } = await import("../src/colors.ts");

    expect(paint.warn("warn")).toBe("warn");
    expect(symbol.ok).toBe("[ok]");
  });

  it("uses semantic symbols when tty output is available", async () => {
    delete process.env.NO_COLOR;
    setIsTTY(true);

    const { paint, symbol } = await import("../src/colors.ts");

    expect(paint.success("ok")).toBe("ok");
    expect(symbol.ok).toBe("✓");
    expect(symbol.warn).toBe("!");
    expect(symbol.error).toBe("x");
  });

  it("pads strings using display width for CJK-safe alignment", async () => {
    const { displayWidth, padEnd } = await import("../src/colors.ts");

    expect(displayWidth("中文")).toBe(4);
    expect(padEnd("中文", 6, ".")).toBe("中文..");
    expect(padEnd("fab", 5)).toBe("fab  ");
  });
});

function setIsTTY(value: boolean): void {
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value,
  });
  Object.defineProperty(process.stderr, "isTTY", {
    configurable: true,
    value,
  });
}

function restoreDescriptor(target: object, key: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor === undefined) {
    return;
  }

  Object.defineProperty(target, key, descriptor);
}
