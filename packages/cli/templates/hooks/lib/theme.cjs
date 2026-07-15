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
  warn: "\x1b[38;2;180;120;0m", // amber
  error: "\x1b[38;2;231;76;60m", // alizarin
  drift: "\x1b[38;2;155;89;182m", // amethyst
  ai: "\x1b[38;2;52;152;219m", // peter-river blue
  human: "\x1b[38;2;26;188;156m", // turquoise
  accent: "\x1b[38;2;155;89;182m", // amethyst
  muted: ANSI.dim,
};

const PALETTE_256 = {
  success: "\x1b[38;5;77m",
  warn: "\x1b[38;5;178m",
  error: "\x1b[38;5;203m",
  drift: "\x1b[38;5;141m",
  ai: "\x1b[38;5;75m",
  human: "\x1b[38;5;80m",
  accent: "\x1b[38;5;141m",
  muted: ANSI.dim,
};

function isColorEnabled(env, isTTY) {
  const e = env || process.env;
  if (e.NO_COLOR) return false;
  const force = e.FORCE_COLOR;
  if (force !== undefined) return force !== "0" && force.toLowerCase() !== "false";
  return Boolean(isTTY === undefined ? process.stdout.isTTY : isTTY);
}

function detectColorDepth(env, isTTY) {
  if (!isColorEnabled(env, isTTY)) return "none";
  const colorterm = String((env && env.COLORTERM) || "").toLowerCase();
  if (colorterm.includes("truecolor") || colorterm.includes("24bit")) return "truecolor";
  const term = String((env && env.TERM) || "").toLowerCase();
  if (term.includes("256color") || term.includes("256")) return "ansi256";
  if (term === "linux" || term === "dumb") return "ansi16";
  return "truecolor";
}


function paint(token, text, colorOn, depth) {
  const on = colorOn === undefined ? isColorEnabled() : colorOn;
  if (depth === undefined) depth = detectColorDepth();
  if (!on || depth === "none") return text;
  const pal = depth === "ansi256" ? PALETTE_256 : PALETTE;
  return `${pal[token]}${text}${ANSI.reset}`;
}

const SYMBOL_ASCII = { ok: "[ok]", warn: "[warn]", error: "[error]" };
const SYMBOL_GLYPH = { ok: "[ok] ✓", warn: "[warn] !", error: "[error] x" };
const SYMBOL_TOKEN = { ok: "success", warn: "warn", error: "error" };

function symbol(kind, colorOn) {
  const on = colorOn === undefined ? isColorEnabled() : colorOn;
  return on ? paint(SYMBOL_TOKEN[kind], SYMBOL_GLYPH[kind], true) : SYMBOL_ASCII[kind];
}

// W3-B structural primitives — HUD-shared layer (C-003), byte-mirror of the TS
// source (packages/shared/src/theme.ts), pinned by theme-parity.test.ts.
function sectionBar(title, colorOn) {
  const on = colorOn === undefined ? isColorEnabled() : colorOn;
  return on ? `${ANSI.bold}${PALETTE.accent}▌ ${title}${ANSI.reset}` : `# ${title}`;
}

// Flat command-level header (B-横线) — byte-mirror of theme.ts headerRule. The
// shared flat replacement for sectionBar across CLI output + .cjs hook surface.
function headerRule(title, colorOn) {
  const on = colorOn === undefined ? isColorEnabled() : colorOn;
  const head = on ? `${ANSI.bold}${PALETTE.human}${title}${ANSI.reset}` : title;
  const rule = paint("muted", (on ? "─" : "-").repeat(40), on);
  return `${head}\n${rule}`;
}

const SCOPE_BADGE_TOKEN = { team: "drift", project: "ai", personal: "human" };
function scopeBadge(scope, colorOn) {
  const on = colorOn === undefined ? isColorEnabled() : colorOn;
  const text = `[${scope}]`;
  return on ? paint(SCOPE_BADGE_TOKEN[scope], text, true) : text;
}

module.exports = {
  PALETTE_256,
  detectColorDepth, ANSI, PALETTE, isColorEnabled, paint, symbol, SYMBOL_ASCII, sectionBar, headerRule, scopeBadge };
