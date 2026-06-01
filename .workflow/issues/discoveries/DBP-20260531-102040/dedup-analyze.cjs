#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const SESSION = 'DBP-20260531-102040';
const dir = path.join('.workflow', 'issues', 'discoveries', SESSION);
const perspectives = ['security', 'performance', 'reliability', 'maintainability', 'ux', 'accessibility', 'compliance', 'scalability'];

const existing = fs.readFileSync('.workflow/issues/issues.jsonl', 'utf8').trim().split('\n').map(JSON.parse)
  .map(x => ({ id: x.id, title: x.title, loc: (x.context && x.context.location) || '', sev: x.severity }));

function parseLoc(loc) {
  const m = /^(.*?):(\d+)/.exec(loc || '');
  if (!m) return { file: loc || '', line: NaN };
  return { file: m[1], line: parseInt(m[2], 10) };
}
const existingByBase = {};
for (const e of existing) {
  const { file, line } = parseLoc(e.loc);
  const base = path.basename(file);
  (existingByBase[base] ||= []).push({ ...e, file, line });
}

for (const p of perspectives) {
  const arr = JSON.parse(fs.readFileSync(path.join(dir, `${p}-findings.json`), 'utf8'));
  for (const f of arr) {
    const { file, line } = parseLoc(f.location);
    const base = path.basename(file);
    const cands = (existingByBase[base] || []).slice().sort((a, b) => Math.abs(a.line - line) - Math.abs(b.line - line));
    const near = cands[0];
    const dist = near ? (isNaN(near.line) || isNaN(line) ? '?' : Math.abs(near.line - line)) : '-';
    console.log(`\n[${p}/${f.severity}] ${f.title}`);
    console.log(`   loc: ${f.location}`);
    if (near) console.log(`   nearest existing: ${near.id} (${near.sev}) @${near.file}:${near.line} Δ${dist}  "${near.title}"`);
    else console.log(`   nearest existing: NONE in ${base}`);
  }
}
