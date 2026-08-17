#!/usr/bin/env node
// B2 S2 — 机械结构归一(R4 复读段处置 + 会话流水出处话术清理)。
//
// 只做**确定性**的结构搬运,不改写任何一条 summary 的语义(那是 S3 的人工/冷评活)。
// 每条改动都可被 --dry 预览、被 git diff 审。
//
//   node normalize-bodies.mjs --root <store 根> [--dry]
//
// 处置矩阵(四态由 R4 实测得出,见 triage.md):
//   verbatim / near / boilerplate → 整段删掉 `## Evidence`
//   diverged                      → Notes 增量并入 `## Context` 末尾,再删段
//   none                          → 仍删 `## Evidence`(其 Recent paths 已由
//                                   frontmatter `evidence_paths` 承载;B1 已在
//                                   生产侧退役这个回退分支)
//
// 另外剥掉三类**出处话术**:它们讲的是"这条是怎么被归档的",不是知识本身,而
// `## Context` 的第一句正是读者最先读到的位置。commit sha / doc 路径是绝对坐标,
// 必须保留 —— 只删围绕它的会话叙述。

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const rootIdx = args.indexOf("--root");
if (rootIdx === -1 || args[rootIdx + 1] === undefined) {
  console.error("usage: normalize-bodies.mjs --root <store-root> [--dry]");
  process.exit(2);
}
const ROOT = join(args[rootIdx + 1], "knowledge");

// --- 出处话术 ---------------------------------------------------------------
// 逐条 anchored 到实际语料里出现的句式。故意写成整句匹配而不是关键词匹配:
// 关键词匹配会咬进正文("用户"在业务里是合法名词,见 summary-voice 的域名词剥离)。
const PROVENANCE = [
  // import 批次的共享话术(实测 8x + 8x 逐字重复,每条增量为零)
  /^用户显式请求\s*fabric-import\s*挖掘知识[^。]*。\s*/u,
  /^用户显式请求\s*fabric-import\s*挖掘知识（[^）]*）[^。]*。\s*/u,
  /^用户提交\s*Cocos\s*组全局编码规范文档[^。]*。(?:文档覆盖[^。]*。)?\s*/u,
  /^用户请求审阅最近提交并归档可复用\s*knowledge。\s*/u,
  // 「无 live session,去看 commit」——读者手上有 commit sha 就够了
  /\s*No live session\s*—\s*see (?:the )?(?:commit bodies|commit body|docs?) for full context\.?/giu,
  // src= 尾巴:与 frontmatter evidence_paths / Origin 行重复
  /\s*src=[^\s，。;；]+/gu,
];

// 会话流水小标题:Session goal / Turning point / Fix 这种把正文写成会议纪要的骨架。
// 只剥标签,保留其后的内容(内容往往是真的诊断过程)。
const MINUTE_LABELS = /(?:^|\s)(?:Session goal|Turning point|Decision|Fix|Why proposed|Session context)\s*[:：]\s*/gu;

function stripProvenance(text) {
  let out = text;
  for (const re of PROVENANCE) out = out.replace(re, "");
  out = out.replace(MINUTE_LABELS, " ");
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// --- Notes 四态 -------------------------------------------------------------
const norm = (s) => (s ?? "").replace(/\s+/gu, "").replace(/[。,，.、;；:：「」“”"']/gu, "");

function bigrams(s) {
  const g = new Set();
  for (let i = 0; i + 1 < s.length; i++) g.add(s.slice(i, i + 2));
  return g;
}

function classify(notes, summary, freq) {
  if (notes === null) return "none";
  const a = norm(notes);
  const b = norm(summary);
  if (a.length === 0) return "none";
  if (a === b) return "verbatim";
  if (a.includes(b) || b.includes(a)) return "near";
  // 逐字重复于多条 = 批次话术,不是本条增量
  if ((freq.get(a) ?? 0) > 1) return "boilerplate";
  const ga = bigrams(a);
  const gb = bigrams(b);
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  const jac = inter / (ga.size + gb.size - inter);
  return jac >= 0.6 ? "near" : "diverged";
}

// --- 文件遍历 ---------------------------------------------------------------
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const a = join(d, n);
    if (statSync(a).isDirectory()) {
      if (n === "rejected") continue;
      walk(a);
    } else if (n.endsWith(".md")) files.push(a);
  }
})(ROOT);

const EVIDENCE_RE = /\n##\s+Evidence\s*\n[\s\S]*?(?=\n##\s|$)/u;
const NOTES_RE = /^Notes:\s*\n\n?([\s\S]*?)(?=\n##\s|\s*$)/mu;

function read(abs) {
  const raw = readFileSync(abs, "utf8");
  const m = /^(---\n[\s\S]*?\n---\n)([\s\S]*)$/u.exec(raw);
  if (m === null) return null;
  const fm = m[1];
  const body = m[2];
  const sm = /^summary:\s*(.*)$/mu.exec(fm);
  const summary = sm ? sm[1].trim().replace(/^["']|["']$/gu, "") : "";
  const ev = EVIDENCE_RE.exec(body);
  const evBlock = ev ? ev[0] : null;
  // `Recent paths` 存量只活在这个段里 —— frontmatter 有 evidence_paths 的是少数
  // (实测 180 条里仅 29 条)。删段前必须先迁,否则是静默丢数据而不是去冗余。
  //
  // 逐行扫,不用「到下一个非空行为止」那种前瞻 —— bullet 行本身就以 `-` 开头
  // 即非空白,那种写法只会吃到第一条,其余静默丢弃。
  const recentPaths = [];
  if (evBlock !== null) {
    const lines = evBlock.split("\n");
    const start = lines.findIndex((l) => /^Recent paths:/u.test(l.trim()));
    if (start !== -1) {
      for (let i = start + 1; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t.length === 0) continue;
        if (!t.startsWith("-")) break; // 到 `Notes:` 之类的下一个标签就停
        const v = t.replace(/^-\s*/u, "").trim();
        if (v.length > 0) recentPaths.push(v);
      }
    }
  }
  const hasEvidencePaths = /^evidence_paths:/mu.test(fm);
  const nm = evBlock ? NOTES_RE.exec(evBlock.replace(/^\n##\s+Evidence\s*\n/u, "")) : null;
  const notes = nm
    ? nm[1]
        .split("\n")
        .filter((l) => l.trim().startsWith("-"))
        .map((l) => l.replace(/^\s*-\s*/u, "").trim())
        .join(" ")
        .trim()
    : null;
  return { raw, fm, body, summary, evBlock, notes, recentPaths, hasEvidencePaths };
}

const parsed = new Map();
const freq = new Map();
for (const f of files) {
  const p = read(f);
  if (p === null) continue;
  parsed.set(f, p);
  if (p.notes) freq.set(norm(p.notes), (freq.get(norm(p.notes)) ?? 0) + 1);
}

const stats = { none: 0, verbatim: 0, near: 0, boilerplate: 0, diverged: 0 };
let changed = 0;
let provenanceStripped = 0;
let migratedPaths = 0;

for (const [abs, p] of parsed) {
  const state = classify(p.notes, p.summary, freq);
  stats[state]++;

  let body = p.body;
  let fm = p.fm;

  // 1) diverged 的增量先并进 ## Context,再删段 —— MUST NOT 纯删分叉段(R4)。
  if (state === "diverged" && p.notes) {
    const inc = stripProvenance(p.notes);
    // 但增量若已在 Context 里(Notes 常复读 Context 首句,不只复读 summary),
    // 合并就会把同一句写两遍。去重轴必须同时覆盖 summary 与 Context。
    const already = norm(body).includes(norm(inc));
    if (inc.length > 0 && !already) {
      const ctx = /^##\s+Context\s*\n/mu.exec(body);
      if (ctx) {
        const insertAt = /(\n##\s+(?!Context)|$)/u.exec(body.slice(ctx.index + ctx[0].length));
        const cut = ctx.index + ctx[0].length + (insertAt ? insertAt.index : 0);
        body = body.slice(0, cut).trimEnd() + "\n\n" + inc + "\n" + body.slice(cut);
      } else {
        body = `## Context\n\n${inc}\n\n` + body;
      }
    }
  }

  // 2) Recent paths 先迁进 frontmatter evidence_paths,再删 ## Evidence 整段。
  //    顺序不能反 —— 段一删,存量条目的证据路径就没有第二个落点了。
  if (p.recentPaths.length > 0 && !p.hasEvidencePaths) {
    const inline = "[" + p.recentPaths.map((x) => JSON.stringify(x)).join(", ") + "]";
    fm = fm.replace(/\n---\n$/u, `\nevidence_paths: ${inline}\n---\n`);
    migratedPaths++;
  }
  if (p.evBlock !== null) body = body.replace(EVIDENCE_RE, "\n");

  // 3) 剥出处话术(保留 commit sha / doc 路径这类绝对坐标)
  // 段界必须是**全文**末尾,不能用 /m —— 带 `m` 时 `$` 是行尾,惰性量词会在
  // Context 第一行就停,只剥掉首行的话术,第三行的 `No live session …` 原样留下
  // (实测真库 8 条残留)。这是欠处理不是丢数据,但护栏只验了路径不丢,测不出来。
  const before = body;
  body = body.replace(/##\s+Context\s*\n([\s\S]*?)(?=\n##\s|$(?![\s\S]))/u, (whole, inner) => {
    const cleaned = stripProvenance(inner);
    return `## Context\n\n${cleaned}\n`;
  });
  if (body !== before) provenanceStripped++;

  body = body.replace(/\n{3,}/gu, "\n\n").trimEnd() + "\n";
  const next = fm + body;
  if (next !== p.raw) {
    changed++;
    if (!DRY) writeFileSync(abs, next);
  }
}

console.log(`files ${parsed.size}  changed ${changed}  provenance-stripped ${provenanceStripped}  evidence_paths-migrated ${migratedPaths}`);
console.log("notes states:", stats);
console.log(DRY ? "(dry run — nothing written)" : "(written)");
