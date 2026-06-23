// ux-w2-5: the single source of truth for Fabric's terminal theme — the vivid,
// multi-colour semantic palette + the render primitives that paint with it.
//
// WHY SHARED: the CLI (this TS module, consumed directly) and the .cjs hooks
// (the byte-locked `lib/theme.cjs` mirror) must render Fabric's output with ONE
// palette. A drift between them is a silent UX seam — the same "Created" / "ok"
// / drift marker rendered a different colour depending on whether it came from
// `fabric install` or a SessionStart hook. The G-THEME parity test
// (theme-parity.test.ts) asserts the TS palette and the .cjs mirror are
// byte-identical, so the two can never quietly diverge (KT-DEC-0039: shared
// renderer over per-surface copies).
//
// This is the Ink-exit prerequisite (W3-A): a self-contained ANSI palette with
// no Ink / picocolors dependency, so the CLI render path can drop Ink onto these
// pure-function primitives without a second migration.

// Vivid truecolor (24-bit) foreground codes. Picked for high-contrast legibility
// on both dark and light terminals — the "鲜明多色" palette locked in NS-00.
// Each value is the SGR escape that opens the colour; RESET closes any of them.
export const ANSI = {
  reset: "[0m",
  bold: "[1m",
  dim: "[2m",
} as const;

// Semantic colour tokens → 24-bit SGR open codes. Keyed by ROLE, never by colour
// name, so a palette re-tune never touches call sites.
export const PALETTE = {
  success: "[38;2;46;204;113m", // emerald
  warn: "[38;2;241;196;15m", // amber
  error: "[38;2;231;76;60m", // alizarin
  drift: "[38;2;155;89;182m", // amethyst
  ai: "[38;2;52;152;219m", // peter-river blue
  human: "[38;2;26;188;156m", // turquoise
  accent: "[38;2;155;89;182m", // amethyst (headers / emphasis)
  muted: ANSI.dim,
} as const;

export type ThemeToken = keyof typeof PALETTE;

// NO_COLOR (https://no-color.org) is an unconditional opt-out; FORCE_COLOR is its
// dual (force ON regardless of TTY). When neither is set, fall back to the TTY
// check. Pure function of the passed env (defaults to process.env) so it is unit
// testable and identical to the .cjs mirror.
export function isColorEnabled(env: NodeJS.ProcessEnv = process.env, isTTY?: boolean): boolean {
  if (env.NO_COLOR) return false;
  const force = env.FORCE_COLOR;
  if (force !== undefined) return force !== "0" && force.toLowerCase() !== "false";
  return Boolean(isTTY ?? process.stdout.isTTY);
}

// Paint `text` with a semantic token, closing with RESET. When colour is
// disabled the raw text is returned verbatim (zero escapes) — the byte contract
// the parity test pins.
export function paint(token: ThemeToken, text: string, colorOn = isColorEnabled()): string {
  if (!colorOn) return text;
  return `${PALETTE[token]}${text}${ANSI.reset}`;
}

// Status glyphs — coloured marker + ascii fallback. The ascii core ([ok]/[warn]/
// [error]) is identical with or without colour so log scrapers stay stable.
export const SYMBOL_ASCII = { ok: "[ok]", warn: "[warn]", error: "[error]" } as const;
const SYMBOL_GLYPH = { ok: "[ok] ✓", warn: "[warn] !", error: "[error] x" } as const;
const SYMBOL_TOKEN = { ok: "success", warn: "warn", error: "error" } as const;

export function symbol(kind: keyof typeof SYMBOL_ASCII, colorOn = isColorEnabled()): string {
  return colorOn ? paint(SYMBOL_TOKEN[kind], SYMBOL_GLYPH[kind], true) : SYMBOL_ASCII[kind];
}

// W3-B structural primitives — HUD-shared layer (C-003): kept parity-trivial so
// the .cjs hook mirror (lib/theme.cjs) stays byte-identical. Complex tree/grid
// are CLI-only (packages/cli/src/tui/structure.ts), never mirrored here.

// Section header: accent bold ▌ bar + title (truecolor) / `# ` prefix (none).
export function sectionBar(title: string, colorOn = isColorEnabled()): string {
  return colorOn ? `${ANSI.bold}${PALETTE.accent}▌ ${title}${ANSI.reset}` : `# ${title}`;
}

// Scope badge: knowledge-layer label painted by role token — team→drift,
// project→ai, personal→human (truecolor) / plain `[scope]` (none).
const SCOPE_BADGE_TOKEN = { team: "drift", project: "ai", personal: "human" } as const;
export function scopeBadge(
  scope: keyof typeof SCOPE_BADGE_TOKEN,
  colorOn = isColorEnabled(),
): string {
  const text = `[${scope}]`;
  return colorOn ? paint(SCOPE_BADGE_TOKEN[scope], text, true) : text;
}
