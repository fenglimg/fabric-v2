#!/usr/bin/env node
// T-1 量化: 解析 vitest --reporter=json 产物, 输出 per-file 耗时慢榜 + 失败清单.
// 用法: node analyze-vitest-report.mjs <report.json> [topN]
import { readFileSync } from "node:fs";

const [, , reportPath, topNRaw] = process.argv;
if (!reportPath) {
  console.error("usage: analyze-vitest-report.mjs <report.json> [topN]");
  process.exit(2);
}
const topN = Number(topNRaw ?? 20);
const report = JSON.parse(readFileSync(reportPath, "utf8"));

const files = (report.testResults ?? []).map((r) => {
  const start = r.startTime ?? 0;
  const end = r.endTime ?? r.assertionResults?.reduce((m, a) => Math.max(m, a.duration ?? 0), 0) ?? 0;
  const wall = r.endTime && r.startTime ? r.endTime - r.startTime : null;
  const assertionSum = (r.assertionResults ?? []).reduce((s, a) => s + (a.duration ?? 0), 0);
  return {
    name: r.name?.replace(process.cwd() + "/", "") ?? "(unknown)",
    status: r.status,
    wall: wall ?? assertionSum,
    assertionSum,
    cases: (r.assertionResults ?? []).length,
    failed: (r.assertionResults ?? []).filter((a) => a.status === "failed").length,
  };
});

const total = files.reduce((s, f) => s + f.wall, 0);
files.sort((a, b) => b.wall - a.wall);

console.log(`# 文件数 ${files.length} | 用例数 ${files.reduce((s, f) => s + f.cases, 0)} | 累计文件耗时 ${(total / 1000).toFixed(1)}s`);
console.log(`# 失败文件 ${files.filter((f) => f.status === "failed").length} | 失败用例 ${files.reduce((s, f) => s + f.failed, 0)}`);
console.log(`\n## Top ${topN} 慢文件 (占累计耗时比例)`);
let cum = 0;
for (const f of files.slice(0, topN)) {
  cum += f.wall;
  console.log(
    `${(f.wall / 1000).toFixed(2).padStart(7)}s  ${((f.wall / total) * 100).toFixed(1).padStart(4)}%  累计${((cum / total) * 100).toFixed(0).padStart(3)}%  ${String(f.cases).padStart(3)}例  ${f.name}`,
  );
}

const failed = files.filter((f) => f.status === "failed");
if (failed.length) {
  console.log(`\n## 失败文件`);
  for (const f of failed) console.log(`  ${f.failed}/${f.cases} 例失败  ${f.name}`);
}

// 长尾分析: 多少文件贡献了 80% 耗时
let acc = 0;
let k = 0;
for (const f of files) {
  acc += f.wall;
  k += 1;
  if (acc >= total * 0.8) break;
}
console.log(`\n## 集中度: ${k}/${files.length} 个文件 (${((k / files.length) * 100).toFixed(0)}%) 贡献了 80% 耗时`);
