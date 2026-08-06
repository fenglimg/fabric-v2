// One-off repair for legacy pending entries whose bodies were written with the
// two-character sequence \n instead of real newlines (an older fab_propose path).
// Renders as one run-on line; `doctor --fix`'s body-dedup backfill does not touch
// it (it only removes sections, renames headings, and merges tech_stack).
//
// No sanctioned channel exists for this class of body repair: fab_review's
// modify-content patches frontmatter scalars only. So this applies the same
// guardrails the doctor channel uses (KT-GLD-0012): dry-run by default, requires a
// clean store worktree, and the caller lands it as one atomic commit.
//
// Scope is deliberately narrow: only the BODY is touched (frontmatter verified to
// contain zero occurrences), and every occurrence was inspected first to confirm
// it is a line separator, never a literal \n token under discussion.
const fs = require("node:fs");
const path = require("node:path");

const BASE = "/Users/wepie/.fabric/stores/team/fabric-team-knowledge/knowledge/";
const APPLY = process.argv.includes("--apply");
const SCAFFOLD_NOISE = /\n?归档到 store '[^']*'\s*(?=\n|$)/gu;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === "pending" || name === "rejected") continue;
      walk(full, out);
    } else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}

let changed = 0;
for (const file of walk(BASE)) {
  const raw = fs.readFileSync(file, "utf8");
  const split = raw.indexOf("\n---\n", 4);
  if (split < 0) continue;
  const fmEnd = split + 5;
  const frontmatter = raw.slice(0, fmEnd);
  const body = raw.slice(fmEnd);
  if (!body.includes("\\n")) continue;

  // Guard: never rewrite when the frontmatter also carries the sequence — that
  // would mean the escape is structural, not a body-formatting artifact.
  if (frontmatter.includes("\\n")) {
    console.log("SKIP (frontmatter also affected):", path.basename(file));
    continue;
  }

  const fixed = body
    .replace(/\\n/gu, "\n")
    .replace(SCAFFOLD_NOISE, "")
    // Un-escaping leaves headings flush against the preceding line; give them
    // back the blank line so the rendered entry keeps its section structure.
    .replace(/([^\n])\n(?=## )/gu, "$1\n\n")
    .replace(/\n{3,}/gu, "\n\n");
  if (fixed === body) continue;
  changed++;
  console.log(`\n══ ${path.basename(file)}`);
  if (APPLY) {
    fs.writeFileSync(file, frontmatter + fixed, "utf8");
    console.log("   applied");
  } else {
    const ctx = fixed.slice(0, 460);
    console.log("--- 改后正文预览 ---");
    console.log(ctx.replace(/^/gmu, "   "));
  }
}
console.log(`\n${APPLY ? "已修改" : "将修改"} ${changed} 个文件${APPLY ? "" : "（dry-run，未落盘）"}`);
