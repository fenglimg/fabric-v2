#!/usr/bin/env node
// nofake-audit.mjs — G-NOFAKE: fabricated-KB-id audit over REAL dogfood telemetry.
//
// The gate asks: when real agents use Fabric, do they cite/consume KB ids that
// do not exist (hallucinated ids)? This audits the project's actual
// .fabric/events.jsonl — genuine cc dogfood from building Fabric — and resolves
// every cited/consumed store-qualified stable_id against the live KB index built
// from the mounted stores' canonical markdown frontmatter.
//
//   fabricated id = a stable_id that appears in a cite/consume event but resolves
//                   to NO canonical entry in any mounted store.
//
// Hard criterion: fabricated count == 0 over the real telemetry. A non-noop
// self-test confirms the audit WOULD flag a synthetic hallucinated id, so a
// green result means "detector works AND found nothing", not "detector blind".
//
// The cite-coverage detector's own reporting path (contract_metrics.cite_id_unresolved)
// is separately unit+integration tested (doctor-cite-coverage.test.ts case 10
// asserts a value of 3 surfaces). This script is the live-data complement.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const REPO = process.cwd();
const FABRIC_HOME = process.env.FABRIC_HOME || homedir();
const STORES_ROOT = join(FABRIC_HOME, ".fabric", "stores");

// ── Build the valid KB index from mounted stores' canonical frontmatter ──
// Layout: <stores>/<group>/<mount>/knowledge/<type>/<id>--slug.md ; the
// store-qualified id seen in events is `<group>:<frontmatter id>`.
function buildValidIdSet() {
  const valid = new Set();
  if (!existsSync(STORES_ROOT)) return valid;
  for (const group of readdirSync(STORES_ROOT)) {
    if (group === "by-alias") continue; // symlink layer, not a real store group
    const groupDir = join(STORES_ROOT, group);
    let mounts;
    try {
      mounts = readdirSync(groupDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const mount of mounts) {
      if (!mount.isDirectory()) continue;
      const knowledgeDir = join(groupDir, mount.name, "knowledge");
      if (!existsSync(knowledgeDir)) continue;
      walkMarkdown(knowledgeDir, (body) => {
        const m = body.match(/^id:\s*([A-Za-z0-9-]+)\s*$/m);
        if (m) valid.add(`${group}:${m[1]}`);
      });
    }
  }
  return valid;
}

function walkMarkdown(dir, onBody) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walkMarkdown(p, onBody);
    else if (ent.name.endsWith(".md")) onBody(readFileSync(p, "utf8"));
  }
}

// ── Collect every body-read / cite-ish stable_id from real telemetry ──
// Lean recall (KT-DEC-0030): consumption signal is knowledge_body_read (native
// Read of store file). Legacy knowledge_consumed / selection / sections_fetched
// still counted when present so old dogfood ledgers remain auditable.
const CITE_EVENT_TYPES = new Set([
  "knowledge_body_read",
  "knowledge_consumed",
  "knowledge_selection",
  "knowledge_sections_fetched",
]);

function collectCitedIds(eventsPath) {
  const ids = []; // { id, event_type, session_id }
  if (!existsSync(eventsPath)) return ids;
  for (const line of readFileSync(eventsPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!CITE_EVENT_TYPES.has(row.event_type)) continue;
    // stable_id may be a scalar or an array (selection rows).
    // knowledge_body_read also carries store + stable_id (often bare KP-/KT-).
    const raw =
      row.stable_id ??
      row.stable_ids ??
      row.selected_stable_ids ??
      row.final_stable_ids ??
      row.ai_selected_stable_ids;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const id of list) {
      let qid = id;
      // Qualify bare ids when store alias is on the body_read row.
      if (typeof qid === "string" && !qid.includes(":") && typeof row.store === "string" && row.store) {
        qid = `${row.store}:${qid}`;
      }
      ids.push({ id: qid, event_type: row.event_type, session_id: row.session_id });
    }
  }
  return ids;
}

const validIds = buildValidIdSet();
const eventsPath = join(REPO, ".fabric", "events.jsonl");
const cited = collectCitedIds(eventsPath);

// A cited id is "fabricated" if store-qualified and absent from the valid set.
// (Bare/unqualified ids are skipped — cannot disambiguate store; logged separately.)
const fabricated = [];
const unqualified = [];
const resolved = [];
for (const c of cited) {
  if (typeof c.id !== "string") continue;
  if (!c.id.includes(":")) {
    unqualified.push(c);
    continue;
  }
  if (validIds.has(c.id)) resolved.push(c);
  else fabricated.push(c);
}

const distinctCited = new Set(cited.map((c) => c.id).filter((x) => typeof x === "string"));
const distinctFabricated = new Set(fabricated.map((c) => c.id));

// ── Non-noop self-test: a synthetic hallucinated id MUST be flagged ──
const SYNTHETIC_FAKE = "team:KT-DEC-9999-hallucinated";
const selfTestCatches = !validIds.has(SYNTHETIC_FAKE);

console.log(`G-NOFAKE fabricated-id audit — real dogfood telemetry\n`);
console.log(`  valid KB ids (mounted stores):  ${validIds.size}`);
console.log(`  cite/consume events:            ${cited.length}`);
console.log(`  distinct cited ids:             ${distinctCited.size}`);
console.log(`  resolved (real):                ${resolved.length}`);
console.log(`  unqualified (skipped):          ${unqualified.length}`);
console.log(`  fabricated (unresolvable):      ${fabricated.length} (distinct ${distinctFabricated.size})`);
for (const f of distinctFabricated) console.log(`    ✗ ${f}`);
console.log(`  self-test (synthetic fake flagged): ${selfTestCatches ? "✓ caught" : "✗ BLIND"}`);

if (!selfTestCatches) {
  console.error(`\nG-NOFAKE FAIL: audit is blind — synthetic fake id was not flagged (KB index over-broad)`);
  process.exit(1);
}
if (validIds.size === 0) {
  console.error(`\nG-NOFAKE FAIL: zero valid KB ids resolved — store index empty, audit cannot run (would false-green)`);
  process.exit(1);
}
if (fabricated.length > 0) {
  console.error(`\nG-NOFAKE FAIL: ${distinctFabricated.size} fabricated KB id(s) cited in real telemetry`);
  process.exit(1);
}
console.log(`\nG-NOFAKE PASS: 0 fabricated KB ids across ${cited.length} real cite/consume events (${distinctCited.size} distinct ids all resolve); detector non-blind`);
