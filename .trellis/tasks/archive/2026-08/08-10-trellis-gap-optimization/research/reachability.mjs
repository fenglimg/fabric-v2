#!/usr/bin/env node
// 从给定入口做 import-graph 可达性分析。
//
// 为什么不用 grep: 子串匹配会把同名私有方法/注释里的提及算成引用(假阳性),
// 而只剥 .js 后缀的粗糙脚本会漏掉写成 .ts 的导入(假阴性)。本脚本解析真实
// import/export specifier, 并对 .js/.ts/无后缀/目录 index 四种写法统一解析。
//
// 用法: node reachability.mjs <pkgRoot> <entry...>
//   node reachability.mjs packages/cli src/index.ts
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

const [, , pkgRoot, ...entries] = process.argv;
if (!pkgRoot || entries.length === 0) {
  console.error("usage: reachability.mjs <pkgRoot> <entry...>");
  process.exit(2);
}

// 只统计 import/export ... from "<spec>" 与 await import("<spec>") 的相对路径
const SPEC_RE = /(?:from\s*|import\s*\(\s*)["']((?:\.|\/)[^"']*)["']/g;

function resolveSpec(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const cands = [];
  // TS 源码里普遍写 .js 后缀指向 .ts 文件 — 必须双向尝试
  if (base.endsWith(".js")) cands.push(base.slice(0, -3) + ".ts");
  if (base.endsWith(".ts")) cands.push(base);
  cands.push(base, base + ".ts", join(base, "index.ts"));
  for (const c of cands) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const reached = new Set();
const unresolved = [];
const queue = entries.map((e) => resolve(pkgRoot, e));

while (queue.length) {
  const file = queue.pop();
  if (reached.has(file) || !existsSync(file)) continue;
  reached.add(file);
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(SPEC_RE)) {
    const target = resolveSpec(file, m[1]);
    if (target) { if (!reached.has(target)) queue.push(target); }
    else unresolved.push(`${relative(pkgRoot, file)} -> ${m[1]}`);
  }
}

// 全量 .ts 源文件
const all = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") && !e.name.includes(".test.")) all.push(p);
  }
})(resolve(pkgRoot, "src"));

const dead = all.filter((f) => !reached.has(f)).sort();
const lines = (f) => readFileSync(f, "utf8").split("\n").length;
const deadLines = dead.reduce((s, f) => s + lines(f), 0);

console.log(`入口: ${entries.join(", ")}`);
console.log(`可达 ${reached.size} 文件 | 源文件总数 ${all.length} | 不可达 ${dead.length} 文件 / ${deadLines} 行\n`);
console.log("## 从入口不可达的源文件");
for (const f of dead) console.log(`${String(lines(f)).padStart(5)}  ${relative(pkgRoot, f)}`);
if (unresolved.length) {
  console.log(`\n## 未能解析的 specifier (${unresolved.length}) — 若非包名即为扫描器盲区`);
  for (const u of unresolved.slice(0, 20)) console.log("  " + u);
}
