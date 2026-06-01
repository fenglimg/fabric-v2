#!/usr/bin/env node
// Round 1 (agy scan): append ALL findings, NO dedup (per user instruction).
const fs = require('fs');
const path = require('path');

const SESSION = 'DBP-20260531-102040';
const DATE = '20260531';
const ROUND = 1;
const ENGINE = 'agy';
const dir = path.join('.workflow', 'issues', 'discoveries', SESSION);
const issuesFile = path.join('.workflow', 'issues', 'issues.jsonl');
const discIssuesFile = path.join(dir, 'discovery-issues.jsonl');
const stateFile = path.join(dir, 'discovery-state.json');
const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

const perspectives = ['security', 'performance', 'reliability', 'maintainability', 'ux', 'accessibility', 'compliance', 'scalability'];

// next ISS number for DATE = max existing for that date + 1
const existing = fs.readFileSync(issuesFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
let maxNum = 0;
for (const e of existing) {
  const m = new RegExp(`^ISS-${DATE}-(\\d+)$`).exec(e.id);
  if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
}

let raw = [];
const perPerspectiveRaw = {};
for (const p of perspectives) {
  const arr = JSON.parse(fs.readFileSync(path.join(dir, `${p}-findings.json`), 'utf8'));
  perPerspectiveRaw[p] = arr.length;
  for (const f of arr) raw.push({ ...f, _perspective: p });
}
const rawCount = raw.length;

const sevRank = { critical: 0, high: 1, medium: 2, low: 3 };
const sevPriority = { critical: 1, high: 2, medium: 3, low: 4 };
raw.forEach((f, i) => { f._idx = i; });
raw.sort((a, b) => {
  const s = sevRank[a.severity] - sevRank[b.severity];
  if (s !== 0) return s;
  const p = perspectives.indexOf(a._perspective) - perspectives.indexOf(b._perspective);
  if (p !== 0) return p;
  return a._idx - b._idx;
});

const records = raw.map((f, i) => {
  const num = String(maxNum + 1 + i).padStart(3, '0');
  return {
    id: `ISS-${DATE}-${num}`,
    title: f.title,
    status: 'registered',
    priority: sevPriority[f.severity],
    severity: f.severity,
    source: 'discovery',
    phase_ref: null,
    gap_ref: null,
    description: f.description,
    fix_direction: f.fix_direction,
    context: {
      location: f.location,
      suggested_fix: '',
      notes: `Discovered by ${f._perspective} perspective in ${SESSION} (engine=${ENGINE}, round ${ROUND}; dedup deferred per user)`,
    },
    analysis: null,
    path: null,
    phase_id: null,
    tags: [f._perspective, `${ENGINE}-scan`, `round-${ROUND}`],
    affected_components: f.affected_components || [],
    feedback: [],
    issue_history: [{ from: null, to: 'registered', actor: 'discovery-agent', at: now }],
    created_at: now,
    updated_at: now,
    resolved_at: null,
    resolution: null,
  };
});

const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
fs.appendFileSync(issuesFile, lines);
fs.writeFileSync(discIssuesFile, lines);

const sevBreak = {}; const perBreak = {};
for (const r of records) {
  sevBreak[r.severity] = (sevBreak[r.severity] || 0) + 1;
  perBreak[r.tags[0]] = (perBreak[r.tags[0]] || 0) + 1;
}

const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
state.status = 'completed';
state.completed_at = now;
state.perspectives_completed = perspectives;
state.dedup = 'deferred (all findings appended raw per user instruction)';
state.issues_found = rawCount;
state.issues_deduplicated = rawCount;
state.severity_breakdown = sevBreak;
state.perspective_breakdown = perBreak;
state.id_range = `ISS-${DATE}-${String(maxNum + 1).padStart(3, '0')} .. ISS-${DATE}-${String(maxNum + records.length).padStart(3, '0')}`;
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');

console.log('RAW per perspective:', JSON.stringify(perPerspectiveRaw));
console.log('appended', records.length, 'records (NO dedup)');
console.log('severity:', JSON.stringify(sevBreak));
console.log('id range:', state.id_range);
console.log('issues.jsonl total now:', existing.length + records.length);
