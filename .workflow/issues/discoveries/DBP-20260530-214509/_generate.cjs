const fs = require('fs');

const SID = 'DBP-20260530-214509';
const DIR = `.workflow/issues/discoveries/${SID}`;
const NOW = '2026-05-30T13:45:09Z';
const PERS = ['security','performance','reliability','maintainability','scalability','ux','accessibility','compliance'];

const sevToPri = { critical: 1, high: 2, medium: 3, low: 4 };

// load all, tag perspective
let raw = [];
for (const p of PERS) {
  const arr = JSON.parse(fs.readFileSync(`${DIR}/${p}-findings.json`, 'utf8'));
  arr.forEach(f => raw.push({ ...f, _perspective: p }));
}
const preDedup = raw.length;

// ---- dedup / merge rules (cross-perspective overlaps) ----
const has = (f, loc) => (f.location || '').includes(loc);

// Merge S1 (id-redirect.ts:41) + S2 (event-ledger.ts:222) INTO P3 (event-ledger.ts:262)
const p3 = raw.find(f => f._perspective === 'performance' && has(f, 'event-ledger.ts:262'));
if (p3) {
  p3.description += ' [MERGED scalability dup] Same root: readEventLedger reads the whole file into a string and Zod-parses every line BEFORE applying the type filter (no pushdown/streaming; event-ledger.ts:222), and id-redirect loadIdRedirectMap (id-redirect.ts:41) invokes this on every plan-context AND recall call — ~3x per fab_recall. Growth angle: at the documented 50MB ledger this is a full read + hundreds-of-K-line parse on the hot path purely to surface rare redirect events.';
  p3.tags = ['performance', 'scalability'];
}
// Fold S6 5s-cache note into P2 (load-active-meta.ts:93)
const p2 = raw.find(f => f._perspective === 'performance' && has(f, 'load-active-meta.ts:93'));
if (p2) {
  p2.description += ' [scalability note] The contextCache meta TTL is only 5s (plan-context.ts:507), so under steady recall traffic this full-KB re-read/re-hash effectively runs per request; cost scales linearly with KB entry count.';
  p2.tags = ['performance', 'scalability'];
}

// drop the merged scalability findings
const dropLocs = ['id-redirect.ts:41', 'event-ledger.ts:222', 'plan-context.ts:507'];
const kept = raw.filter(f => !(f._perspective === 'scalability' && dropLocs.some(l => has(f, l))));
const postDedup = kept.length;

// ---- build issue records ----
const pad = n => String(n).padStart(3, '0');
const records = kept.map((f, i) => {
  const id = `ISS-20260530-${pad(i + 1)}`;
  const tags = f.tags || [f._perspective];
  return {
    id,
    title: f.title,
    status: 'registered',
    priority: sevToPri[f.severity] || 3,
    severity: f.severity,
    source: 'discovery',
    phase_ref: null,
    gap_ref: null,
    description: f.description,
    fix_direction: f.fix_direction || '',
    context: {
      location: f.location || '',
      suggested_fix: '',
      notes: `Discovered by ${f._perspective} perspective in ${SID}`,
    },
    analysis: null,
    path: null,
    phase_id: null,
    tags,
    affected_components: f.affected_components || [],
    feedback: [],
    issue_history: [{ from: null, to: 'registered', actor: 'discovery-agent', at: NOW }],
    created_at: NOW,
    updated_at: NOW,
    resolved_at: null,
    resolution: null,
  };
});

const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
fs.appendFileSync('.workflow/issues/issues.jsonl', lines);
fs.writeFileSync(`${DIR}/discovery-issues.jsonl`, lines);

// finalize state
const state = JSON.parse(fs.readFileSync(`${DIR}/discovery-state.json`, 'utf8'));
state.status = 'completed';
state.completed_at = NOW;
state.perspectives_completed = PERS;
state.issues_found = preDedup;
state.issues_deduplicated = postDedup;
fs.writeFileSync(`${DIR}/discovery-state.json`, JSON.stringify(state, null, 2));

// report
const bySev = {}, byPers = {};
records.forEach(r => {
  bySev[r.severity] = (bySev[r.severity] || 0) + 1;
  r.tags.forEach(t => { byPers[t] = (byPers[t] || 0) + 1; });
});
console.log(`pre-dedup=${preDedup} post-dedup=${postDedup} (merged ${preDedup - postDedup})`);
console.log('severity:', JSON.stringify(bySev));
console.log('by-tag:', JSON.stringify(byPers));
console.log('ids:', records[0].id, '..', records[records.length - 1].id);
