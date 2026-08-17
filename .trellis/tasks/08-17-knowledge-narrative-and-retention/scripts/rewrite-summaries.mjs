#!/usr/bin/env node
// B2 S3 — summary 重写落盘器(内容在 summaries/*.json,本脚本只负责安全写入)。
//
//   node rewrite-summaries.mjs --store <store 根> --map <mapping.json> [--dry]
//
// mapping.json 形如 { "<store knowledge 下的相对路径>": "<新 summary>" }。
//
// 三条护栏,都是踩过才加的:
// ① summary 在 frontmatter 里是**不带引号**的标量,所以正文不能出现 ": "(冒号+空格)
//    或以 YAML 特殊字符开头 —— 否则整份 frontmatter 解析歪掉,而症状是「这条知识
//    莫名不浮现」,极难归因。写入前逐条断言。
// ② 只替换 `summary:` 那一行,其余字节不动。
// ③ 写完立刻回读,断言解析出来的 summary 与意图逐字相等(round-trip),
//    别信「写进去了」。

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const flag = (n) => {
  const i = args.indexOf(n);
  return i === -1 ? undefined : args[i + 1];
};
const STORE = flag("--store");
const MAP = flag("--map");
if (STORE === undefined || MAP === undefined) {
  console.error("usage: rewrite-summaries.mjs --store <store-root> --map <mapping.json> [--dry]");
  process.exit(2);
}
const K = join(STORE, "knowledge");
const mapping = JSON.parse(readFileSync(MAP, "utf8"));

const BAD_LEAD = /^[-?:,[\]{}#&*!|>'"%@`]/u;

let n = 0;
const problems = [];
for (const [rel, next] of Object.entries(mapping)) {
  if (next.includes(": ")) problems.push(`${rel}: summary 含 ": ",会破坏 YAML 标量`);
  if (BAD_LEAD.test(next)) problems.push(`${rel}: summary 以 YAML 特殊字符开头`);
  if (next.includes("\n")) problems.push(`${rel}: summary 含换行`);
}
if (problems.length > 0) {
  for (const p of problems) console.error("REJECT " + p);
  process.exit(1);
}

for (const [rel, next] of Object.entries(mapping)) {
  const abs = join(K, rel);
  const raw = readFileSync(abs, "utf8");
  const re = /^summary:.*$/mu;
  if (!re.test(raw)) {
    console.error("REJECT " + rel + ": 没有 summary 行");
    process.exit(1);
  }
  const out = raw.replace(re, `summary: ${next}`);
  if (!DRY) {
    writeFileSync(abs, out);
    // round-trip:回读并逐字比对,别信写入本身
    const back = readFileSync(abs, "utf8");
    const got = /^summary:\s*(.*)$/mu.exec(back)?.[1] ?? "";
    if (got !== next) {
      console.error("REJECT " + rel + ": round-trip 不一致");
      process.exit(1);
    }
  }
  n++;
  console.log(`${DRY ? "would rewrite" : "rewrote"}  ${rel}`);
}
console.log(`\n${DRY ? "(dry run)" : "written"}: ${n} summaries`);
