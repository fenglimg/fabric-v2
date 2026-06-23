// ux-w2-5: the .cjs mirror of packages/shared/src/theme.ts — the hook-side half
// of Fabric's single terminal theme. Byte-locked to the TS source by
// theme-parity.test.ts (G-THEME): the PALETTE / ANSI tables and the paint/symbol
// render primitives MUST produce byte-identical output here and in the CLI, so a
// SessionStart hint and `fabric install` paint the same colours. No deps (no Ink,
// no picocolors) — pure ANSI, matching the Ink-exit direction (W3-A).

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

const PALETTE = {
  success: "\x1b[38;2;46;204;113m", // emerald
  warn: "\x1b[38;2;241;196;15m", // amber
  error: "\x1b[38;2;231;76;60m", // alizarin
  drift: "\x1b[38;2;155;89;182m", // amethyst
  ai: "\x1b[38;2;52;152;219m", // peter-river blue
  human: "\x1b[38;2;26;188;156m", // turquoise
  accent: "\x1b[38;2;155;89;182m", // amethyst
  muted: ANSI.dim,
};

function isColorEnabled(env, isTTY) {
  const e = env || process.env;
  if (e.NO_COLOR) return false;
  const force = e.FORCE_COLOR;
  if (force !== undefined) return force !== "0" && force.toLowerCase() !== "false";
  return Boolean(isTTY === undefined ? process.stdout.isTTY : isTTY);
}

function paint(token, text, colorOn) {
  const on = colorOn === undefined ? isColorEnabled() : colorOn;
  if (!on) return text;
  return `${PALETTE[token]}${text}${ANSI.reset}`;
}

const SYMBOL_ASCII = { ok: "[ok]", warn: "[warn]", error: "[error]" };
const SYMBOL_GLYPH = { ok: "[ok] ✓", warn: "[warn] !", error: "[error] x" };
const SYMBOL_TOKEN = { ok: "success", warn: "warn", error: "error" };

function symbol(kind, colorOn) {
  const on = colorOn === undefined ? isColorEnabled() : colorOn;
  return on ? paint(SYMBOL_TOKEN[kind], SYMBOL_GLYPH[kind], true) : SYMBOL_ASCII[kind];
}

module.exports = { ANSI, PALETTE, isColorEnabled, paint, symbol, SYMBOL_ASCII };
