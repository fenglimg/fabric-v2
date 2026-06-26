/**
 * ux-w2-5 G-THEME: byte-identical parity between the TS theme source
 * (packages/shared/src/theme.ts, consumed by the CLI) and its .cjs mirror
 * (templates/hooks/lib/theme.cjs, consumed by the hooks). A drift here is a
 * silent UX seam — the same role rendered a different colour depending on the
 * surface. This census pins the two halves together (mirrors the banner-i18n /
 * bootstrap-canonical parity precedent).
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import * as themeTs from "@fenglimg/fabric-shared/theme";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const themeCjs = require(
  fileURLToPath(new URL("../templates/hooks/lib/theme.cjs", import.meta.url)),
) as typeof themeTs & { PALETTE: Record<string, string>; ANSI: Record<string, string> };

const TOKENS = ["success", "warn", "error", "drift", "ai", "human", "accent", "muted"] as const;
const SYMBOLS = ["ok", "warn", "error"] as const;

describe("theme TS ↔ cjs byte parity (ux-w2-5)", () => {
  it("ANSI + PALETTE tables are byte-identical", () => {
    expect(themeCjs.ANSI).toEqual(themeTs.ANSI);
    expect(themeCjs.PALETTE).toEqual(themeTs.PALETTE);
  });

  it("paint() emits byte-identical escapes for every token (color on)", () => {
    for (const token of TOKENS) {
      expect(themeCjs.paint(token, "X", true), token).toBe(themeTs.paint(token, "X", true));
    }
  });

  it("paint() returns the raw text for every token (color off)", () => {
    for (const token of TOKENS) {
      expect(themeCjs.paint(token, "X", false)).toBe("X");
      expect(themeTs.paint(token, "X", false)).toBe("X");
    }
  });

  it("symbol() is byte-identical on and off", () => {
    for (const kind of SYMBOLS) {
      expect(themeCjs.symbol(kind, true), kind).toBe(themeTs.symbol(kind, true));
      expect(themeCjs.symbol(kind, false), kind).toBe(themeTs.symbol(kind, false));
    }
  });

  it("sectionBar() is byte-identical on and off (W3-B)", () => {
    for (const on of [true, false]) {
      expect(themeCjs.sectionBar("Store Health", on), String(on)).toBe(
        themeTs.sectionBar("Store Health", on),
      );
    }
  });

  it("headerRule() is byte-identical on and off (flat header, shared CLI+hook)", () => {
    for (const on of [true, false]) {
      expect(themeCjs.headerRule("Store Health", on), String(on)).toBe(
        themeTs.headerRule("Store Health", on),
      );
    }
  });

  it("scopeBadge() is byte-identical for every scope on and off (W3-B)", () => {
    for (const scope of ["team", "project", "personal"] as const) {
      for (const on of [true, false]) {
        expect(themeCjs.scopeBadge(scope, on), `${scope}:${on}`).toBe(
          themeTs.scopeBadge(scope, on),
        );
      }
    }
  });

  it("isColorEnabled() agrees across NO_COLOR / FORCE_COLOR / TTY", () => {
    const cases: Array<[NodeJS.ProcessEnv, boolean]> = [
      [{ NO_COLOR: "1" }, false],
      [{ FORCE_COLOR: "1" }, true],
      [{ FORCE_COLOR: "0" }, false],
      [{}, true],
      [{}, false],
    ];
    for (const [env, tty] of cases) {
      expect(themeCjs.isColorEnabled(env, tty)).toBe(themeTs.isColorEnabled(env, tty));
    }
  });
});
