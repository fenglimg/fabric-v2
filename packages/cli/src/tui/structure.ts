// W3-B structural primitives — CLI-only layer (C-003). Complex tree/grid render
// helpers used by TS surfaces (doctor / install / error). Deliberately NOT
// mirrored into the .cjs hook (lib/theme.cjs) — the parity surface stays trivial
// (only sectionBar/scopeBadge live shared in theme.ts). Differentiation comes
// from STRUCTURE; color is the 7-token accent layer only.

import { paint, isColorEnabled, displayWidth, padEnd } from "../colors.js";

export interface TreeItem {
  /** Optional leading marker (e.g. a badge) rendered after the branch glyph. */
  marker?: string;
  /** Row text. */
  text: string;
}

export interface TreeOpts {
  /** Left indent before the branch glyph. Default two spaces. */
  indent?: string;
}

/**
 * Render a flat list as a tree: `├─ ` for non-last rows, `└─ ` for the last.
 * ASCII fallback (NO_COLOR / non-TTY): `+- ` / `` `- ``. Branch glyphs painted
 * muted; the fallback returns raw text so log scrapers stay stable.
 */
export function tree(items: TreeItem[], opts: TreeOpts = {}): string {
  const on = isColorEnabled();
  const indent = opts.indent ?? "  ";
  const mid = on ? "├─ " : "+- ";
  const last = on ? "└─ " : "`- ";
  return items
    .map((it, i) => {
      const branch = paint.muted(i === items.length - 1 ? last : mid);
      const marker = it.marker ? `${it.marker} ` : "";
      return `${indent}${branch}${marker}${it.text}`;
    })
    .join("\n");
}

export interface GridOpts {
  /** Insert a muted rule line (`─────` / `-----`) after the first row (header). */
  rule?: boolean;
  /** Spaces between columns. Default 2. */
  gap?: number;
}

/**
 * Render rows as an aligned grid: each column padded to its widest cell via the
 * wide-char-safe padEnd. Optional muted rule line after the header row. ASCII
 * fallback uses `-` for the rule.
 */
export function grid(rows: string[][], opts: GridOpts = {}): string {
  const on = isColorEnabled();
  const gap = opts.gap ?? 2;
  const cols = rows.length > 0 ? Math.max(...rows.map((r) => r.length)) : 0;
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) {
    widths[c] = Math.max(0, ...rows.map((r) => displayWidth(r[c] ?? "")));
  }
  const sep = " ".repeat(gap);
  const lines = rows.map((r) =>
    r
      .map((cell, c) => (c === r.length - 1 ? (cell ?? "") : padEnd(cell ?? "", widths[c])))
      .join(sep),
  );
  if (opts.rule && lines.length > 0) {
    const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, cols - 1);
    const ruleLine = paint.muted((on ? "─" : "-").repeat(total));
    lines.splice(1, 0, ruleLine);
  }
  return lines.join("\n");
}

// 平铺风命令级大标题(B-横线,spec §0.4)现住 shared theme(KT-DEC-0039:CLI 与
// .cjs hook 共用一份 renderer,避免 per-surface 副本漂移)。CLI 侧 re-export 保持
// `./structure.js` 的既有 import 入口不变;hook 侧由 lib/theme.cjs 镜像取用。
export { headerRule } from "@fenglimg/fabric-shared/theme";

/**
 * 平铺风内部分组标题(C-圆点,spec §0.4):muted 点 `● <label>`。
 * 点本身是结构标记、非状态,故走 dim —— 颜色留给行内的状态符号(success-green ✓
 * / warn-amber ○ / error-red ✗)扛信息;一行行重复的圆点若上品牌色会变成一条噪声竖墙。
 * NO_COLOR / 非 TTY 降级为 ASCII `* <label>`。
 */
export function groupDot(label: string): string {
  const dot = isColorEnabled() ? paint.muted("●") : "*";
  return `${dot} ${label}`;
}
