#!/usr/bin/env node
// red-team-safety.mjs — G-SAFETY adversarial red team against the REAL product guards.
//
// This is not a unit test re-run — it mounts concrete attacks against the actual
// exported guard functions and asserts each is contained. Five attack classes:
//
//   1. KB poisoning (credential leak)  — scanForSecrets must BLOCK a body carrying
//      AWS/OpenAI/GitHub/private-key/credential-assignment strings; redaction must
//      never echo the secret value back.
//   2. Path traversal (store alias)    — storeAliasSchema / storeMountNameSchema must
//      REJECT ../, absolute, multi-segment, dotfile, and . / .. inputs.
//   3. Budget runaway (payload guard)  — enforcePayloadLimit must flag an oversized
//      payload at the hard threshold; an unbounded blob does not pass clean.
//   4. Prompt-injection containment    — KB bodies are inert data: assert ZERO
//      eval()/new Function()/exec-of-body in the recall + injection code paths, so a
//      poisoned body with embedded instructions can never be executed.
//   5. PII leak on write path          — redactPii must scrub an email before a body
//      could land in a shared store git.
//
// Each attack records expected=BLOCKED/REJECTED and the actual verdict. Any attack
// that gets through (guard fails open) → non-zero exit. Hard gate: zero breaches.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  scanForSecrets,
  hasSecrets,
  redactSecrets,
  redactPii,
  storeAliasSchema,
  storeMountNameSchema,
} from "/Users/wepie/Desktop/personal-projects/pcf-release-eval/packages/shared/dist/index.js";
import {
  enforcePayloadLimit,
  PAYLOAD_LIMIT_DEFAULT_HARD_BYTES,
} from "/Users/wepie/Desktop/personal-projects/pcf-release-eval/packages/shared/dist/node/mcp-payload-guard.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const breaches = [];
const results = [];
const record = (klass, vector, expected, contained, detail) => {
  results.push({ klass, vector, expected, contained, detail });
  if (!contained) breaches.push({ klass, vector, detail });
};

// ── 1. KB poisoning — credential bodies must be blocked, value never echoed ──
const SECRET_PAYLOADS = {
  "aws-access-key-id": "deploy note: use AKIAIOSFODNN7EXAMPLE for the bucket",
  "openai-api-key": "set OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz0123456789",
  "github-token": "token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  "private-key-block": "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXkt\n-----END OPENSSH PRIVATE KEY-----",
  "credential-assignment": 'config: password = "hunter2supersecret"',
};
for (const [label, body] of Object.entries(SECRET_PAYLOADS)) {
  const findings = scanForSecrets(body);
  const blocked = findings.length > 0 && hasSecrets(body);
  // Redaction must not leak the raw secret token back.
  const redacted = redactSecrets(body);
  const rawSecret = body.match(/(AKIA\w+|sk-\w+|ghp_\w+|hunter2\w+)/)?.[0];
  const leaks = rawSecret ? redacted.includes(rawSecret) : false;
  record(
    "kb-poison-credential",
    label,
    "BLOCKED+REDACTED",
    blocked && !leaks,
    `findings=${findings.map((f) => f.rule).join(",")} redactionLeaks=${leaks}`,
  );
}

// ── 2. Path traversal — malicious aliases / mount names must be rejected ──
const TRAVERSAL_VECTORS = [
  "../../etc/passwd",
  "..",
  ".",
  "a/b",
  "/abs/path",
  "foo\nbar",
  "x".repeat(200),
  "..\\..\\windows",
];
for (const vec of TRAVERSAL_VECTORS) {
  const aliasRej = !storeAliasSchema.safeParse(vec).success;
  const mountRej = !storeMountNameSchema.safeParse(vec).success;
  record(
    "path-traversal",
    JSON.stringify(vec).slice(0, 30),
    "REJECTED",
    aliasRej && mountRej,
    `aliasRejected=${aliasRej} mountRejected=${mountRej}`,
  );
}

// ── 3. Budget runaway — oversized payload must be hard-stopped (fail-closed) ──
{
  // Over hard limit: the guard THROWS McpPayloadTooLargeError — strongest
  // containment, an unbounded blob can never pass through.
  const blob = "x".repeat(PAYLOAD_LIMIT_DEFAULT_HARD_BYTES + 50_000); // ~115KB
  let threw = false;
  let code = "none";
  try {
    enforcePayloadLimit(blob);
  } catch (e) {
    threw = true;
    code = e?.code ?? e?.constructor?.name ?? "throw";
  }
  record("budget-runaway", `${Math.round(blob.length / 1024)}KB over-hard blob`, "HARD-STOP(throw)", threw, `threw=${threw} code=${code}`);

  // Between warn and hard: returns a warning code (surfaced, not silent).
  const warnBlob = "x".repeat(PAYLOAD_LIMIT_DEFAULT_HARD_BYTES - 10_000); // ~55KB
  const warnRes = enforcePayloadLimit(warnBlob);
  record("budget-runaway", `${Math.round(warnBlob.length / 1024)}KB warn-band`, "WARNED", warnRes.warning?.code === "mcp_payload_warn", `warning=${warnRes.warning?.code ?? "none"}`);

  // Small payload passes clean (no false positive — guard not trigger-happy).
  const small = enforcePayloadLimit("ok");
  record("budget-runaway", "2B clean payload", "CLEAN", small.warning === undefined, `warning=${small.warning?.code ?? "none"}`);
}

// ── 4. Prompt-injection containment — KB bodies are inert data, never executed ──
{
  // Scan the recall + injection code paths for any dynamic execution of content.
  const scanDirs = [
    "packages/server/src/tools",
    "packages/cli/templates/hooks",
  ];
  const EXEC_RE = /\beval\s*\(|new\s+Function\s*\(|execSync\([^)]*\b(body|content|knowledge)\b|child_process[\s\S]{0,40}\b(body|content)\b/;
  const offenders = [];
  const walk = (rel) => {
    for (const ent of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const childRel = `${rel}/${ent.name}`;
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === "lib") continue;
        walk(childRel);
      } else if (/\.(ts|cjs)$/.test(ent.name) && !/\.test\.ts$/.test(ent.name)) {
        const body = readFileSync(join(ROOT, childRel), "utf8");
        if (EXEC_RE.test(body)) offenders.push(childRel);
      }
    }
  };
  for (const d of scanDirs) walk(d);
  record(
    "injection-containment",
    "no eval/exec of KB body in recall+inject path",
    "INERT",
    offenders.length === 0,
    offenders.length ? `offenders=${offenders.join(",")}` : "zero dynamic execution of content",
  );
}

// ── 5. PII leak on write path — email must be scrubbed ──
{
  const body = "contact me at alice.attacker@evil.example.com for the leak";
  const scrubbed = redactPii(body);
  const contained = !scrubbed.includes("alice.attacker@evil.example.com");
  record("pii-leak", "email in body", "SCRUBBED", contained, `scrubbed="${scrubbed.slice(0, 50)}"`);
}

// ── Report ──
console.log(`G-SAFETY red team — ${results.length} attack vectors across 5 classes\n`);
const byClass = {};
for (const r of results) {
  (byClass[r.klass] ??= { total: 0, contained: 0 }).total++;
  if (r.contained) byClass[r.klass].contained++;
  const mark = r.contained ? "✓ contained" : "✗ BREACH";
  console.log(`  [${r.klass}] ${r.vector} → expect ${r.expected}: ${mark}  (${r.detail})`);
}
console.log("");
for (const [k, c] of Object.entries(byClass)) {
  console.log(`  ${k.padEnd(22)} ${c.contained}/${c.total} contained`);
}

if (breaches.length > 0) {
  console.error(`\nG-SAFETY FAIL: ${breaches.length} breach(es) — a guard failed open`);
  for (const b of breaches) console.error(`    ✗ [${b.klass}] ${b.vector}: ${b.detail}`);
  process.exit(1);
}
console.log(`\nG-SAFETY PASS: all ${results.length} attacks contained (credential/PII blocked, traversal rejected, budget bounded, KB bodies inert)`);
