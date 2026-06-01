#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const SESSION = 'DBP-20260531-100005';
const DATE = '20260531';
const dir = path.join('.workflow', 'issues', 'discoveries', SESSION);
const issuesFile = path.join('.workflow', 'issues', 'issues.jsonl');
const discIssuesFile = path.join(dir, 'discovery-issues.jsonl');
const stateFile = path.join(dir, 'discovery-state.json');
const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

const perspectives = ['security', 'performance', 'reliability', 'maintainability', 'ux', 'accessibility', 'compliance', 'scalability'];

let raw = [];
const perPerspectiveRaw = {};
for (const p of perspectives) {
  const fp = path.join(dir, `${p}-findings.json`);
  const arr = JSON.parse(fs.readFileSync(fp, 'utf8'));
  perPerspectiveRaw[p] = arr.length;
  for (const f of arr) raw.push({ ...f, _perspective: p });
}
const rawCount = raw.length;

// --- Dedup: silent ledger-append swallow appears in both reliability and ux ---
// Drop the reliability copy; tag the canonical ux finding with both perspectives.
raw = raw.filter(f => !(f._perspective === 'reliability' && /^Silent swallowing of audit ledger/.test(f.title)));
for (const f of raw) {
  if (f._perspective === 'ux' && /^Silent Event Ledger append failure/.test(f.title)) {
    f._extraTags = ['reliability'];
  }
}
const uniqueCount = raw.length;

// --- Sort by severity then perspective order (stable) ---
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
  const num = String(i + 1).padStart(3, '0');
  const tags = [f._perspective, ...(f._extraTags || [])];
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
      notes: `Discovered by ${f._perspective} perspective in ${SESSION} (Gemini delegate)`,
    },
    analysis: null,
    path: null,
    phase_id: null,
    tags,
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

// severity + perspective breakdown
const sevBreak = {}; const perBreak = {};
for (const r of records) {
  sevBreak[r.severity] = (sevBreak[r.severity] || 0) + 1;
  perBreak[r.tags[0]] = (perBreak[r.tags[0]] || 0) + 1;
}

const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
state.status = 'completed';
state.completed_at = now;
state.perspectives_completed = perspectives;
state.issues_found = rawCount;
state.issues_deduplicated = uniqueCount;
state.severity_breakdown = sevBreak;
state.perspective_breakdown = perBreak;
state.id_range = `ISS-${DATE}-001 .. ISS-${DATE}-${String(records.length).padStart(3, '0')}`;
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');

console.log('RAW per perspective:', JSON.stringify(perPerspectiveRaw));
console.log('raw total:', rawCount, '-> unique:', uniqueCount);
console.log('severity:', JSON.stringify(sevBreak));
console.log('perspective:', JSON.stringify(perBreak));
console.log('id range:', state.id_range);
console.log('appended', records.length, 'records to', issuesFile);
