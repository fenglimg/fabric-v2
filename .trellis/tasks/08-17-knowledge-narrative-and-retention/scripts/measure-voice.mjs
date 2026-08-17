#!/usr/bin/env node
// B2 验收测量器:对 store 里每条知识的 summary 跑 assessSummaryVoice(会话人称 lint),
// 顺带做一次 frontmatter YAML 全量解析(改 summary 最容易砸的就是 YAML 标量)。
//
//   node --experimental-strip-types measure-voice.mjs --store <store 根>
//
// 用产品自己的 lint 而不是手搓正则 —— 我手搓的那版漏掉「用户让我/用户按批投喂」
// 之类的说法,得出过一个错的误报数。口径要与线上一致才有验收意义。

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "../../../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/index.js";
import { assessSummaryVoice } from "../../../../packages/server/src/services/summary-voice.ts";

const args = process.argv.slice(2);
const i = args.indexOf("--store");
const STORE = i === -1 ? undefined : args[i + 1];
if (STORE === undefined) {
  console.error("usage: measure-voice.mjs --store <store-root>");
  process.exit(2);
}
const K = join(STORE, "knowledge");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walk(abs));
    else if (name.endsWith(".md")) out.push(abs);
  }
  return out;
}

const buckets = { canonical: [], pending: [] };
const yamlFails = [];
let total = 0;

for (const abs of walk(K)) {
  const rel = abs.slice(K.length + 1);
  const bucket = rel.startsWith("pending/") ? "pending" : "canonical";
  const raw = readFileSync(abs, "utf8");
  const m = /^---\n([\s\S]*?)\n---\n/u.exec(raw);
  if (m === null) {
    yamlFails.push(`${rel}: 无 frontmatter`);
    continue;
  }
  let fm;
  try {
    fm = parseYaml(m[1]);
  } catch (err) {
    yamlFails.push(`${rel}: ${err.message.split("\n")[0]}`);
    continue;
  }
  total++;
  const summary = typeof fm?.summary === "string" ? fm.summary : "";
  if (summary === "") {
    yamlFails.push(`${rel}: summary 缺失或非字符串`);
    continue;
  }
  const verdict = assessSummaryVoice(summary);
  if (verdict.ok === false) {
    buckets[bucket].push({ rel, detail: verdict.detail });
  }
}

const counts = { canonical: 0, pending: 0 };
for (const abs of walk(K)) {
  const rel = abs.slice(K.length + 1);
  counts[rel.startsWith("pending/") ? "pending" : "canonical"]++;
}

for (const b of ["canonical", "pending"]) {
  console.log(`\n== ${b}: ${buckets[b].length}/${counts[b]} 命中会话人称 ==`);
  for (const h of buckets[b]) console.log(`  ${h.rel}  ${h.detail}`);
}
console.log(`\nYAML 解析: ${total} 条通过, ${yamlFails.length} 条失败`);
for (const f of yamlFails) console.log(`  FAIL ${f}`);
process.exit(yamlFails.length > 0 ? 1 : 0);
