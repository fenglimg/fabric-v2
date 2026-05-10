#!/usr/bin/env node
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

// CONSTANTS — duplicated from packages/server/src/services/_shared.ts.
// DRY violation accepted: this hook script runs in user repos WITHOUT
// node_modules access, so it cannot import from @fenglimg/fabric-server.
const FABRIC_DIR = ".fabric";
const EVENT_LEDGER_FILE = "events.jsonl";
const EVENT_TYPE_PROPOSED = "knowledge_proposed";
const EVENT_TYPE_PLAN_CONTEXT = "knowledge_context_planned";
const THRESHOLD_PLAN_CONTEXTS = 5;
const THRESHOLD_HOURS = 24;
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Read the events.jsonl ledger from <projectRoot>/.fabric/events.jsonl.
 * Mirrors the semantics of readEventLedger in packages/server/src/services/event-ledger.ts:
 *   - ENOENT → return [] (fabric not initialized)
 *   - split on /\r?\n/
 *   - drop final fragment if file lacks trailing newline (partial-tail tolerance)
 *   - JSON.parse per line, swallow per-line errors (corrupt-line tolerance)
 */
function readLedger(projectRoot) {
  const eventPath = join(projectRoot, FABRIC_DIR, EVENT_LEDGER_FILE);
  if (!existsSync(eventPath)) {
    return [];
  }

  let raw;
  try {
    raw = readFileSync(eventPath, "utf8");
  } catch {
    return [];
  }

  const lines = raw.split(/\r?\n/);
  const hasTrailingNewline = raw.endsWith("\n");
  if (!hasTrailingNewline && lines.length > 0) {
    lines.pop();
  }

  const events = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        events.push(parsed);
      }
    } catch {
      // corrupt JSON line — drop silently
    }
  }
  return events;
}

/**
 * Decide whether to emit an archive-reminder.
 *
 * Threshold logic (per discussion.md L355-L362):
 *   - Trigger when (plan_context count since last knowledge_proposed >= 5)
 *     OR (hours since last knowledge_proposed >= 24).
 *   - If no knowledge_proposed event has ever been recorded, count ALL
 *     plan_context events and treat hours-elapsed as Infinity.
 *
 * Returns the hook decision object on trigger, or null on no-trigger.
 */
function decide(events, now) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now();

  // Walk events from tail to find the most-recent knowledge_proposed.
  let lastProposedTs = null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev && ev.event_type === EVENT_TYPE_PROPOSED && typeof ev.ts === "number") {
      lastProposedTs = ev.ts;
      break;
    }
  }

  // Count plan_context events AFTER lastProposedTs (or all if never proposed).
  let planContextCount = 0;
  for (const ev of events) {
    if (!ev || ev.event_type !== EVENT_TYPE_PLAN_CONTEXT) continue;
    if (typeof ev.ts !== "number") continue;
    if (lastProposedTs === null || ev.ts > lastProposedTs) {
      planContextCount += 1;
    }
  }

  const hoursElapsed =
    lastProposedTs === null ? null : (nowMs - lastProposedTs) / MS_PER_HOUR;

  const triggerByCount = planContextCount >= THRESHOLD_PLAN_CONTEXTS;
  // Hours threshold only applies when a previous knowledge_proposed exists AND
  // at least one plan_context has happened since (otherwise the user has been
  // idle, no knowledge to archive).
  const triggerByHours =
    hoursElapsed !== null && hoursElapsed >= THRESHOLD_HOURS && planContextCount > 0;

  if (!triggerByCount && !triggerByHours) {
    return null;
  }

  const hoursDisplay = hoursElapsed === null ? "尚未归档" : `${hoursElapsed.toFixed(1)}h`;
  const reason =
    `已积累 ${planContextCount} 次 plan_context 调用且距上次 knowledge_proposed ${hoursDisplay}` +
    " — 建议调用 fabric-archive skill 抽取本次会话的知识。";

  return { decision: "block", reason };
}

/**
 * Main entry — invoked both as a CLI (require.main === module) and in-process by tests.
 *
 * Wraps the entire flow in try/catch: ANY error → silent exit 0. The hook MUST NEVER
 * block tool execution on its own failure (per existing fabric-*-reminder.cjs precedent).
 */
function main(env, stdio) {
  try {
    const cwd = (env && env.cwd) || process.cwd();
    const now = (env && env.now) || new Date();
    const out = (stdio && stdio.stdout) || process.stdout;

    const events = readLedger(cwd);
    const result = decide(events, now);
    if (result !== null) {
      out.write(JSON.stringify(result));
    }
  } catch {
    // Silent — never block on hook failure.
  }
}

module.exports = {
  main,
  readLedger,
  decide,
  CONSTANTS: {
    FABRIC_DIR,
    EVENT_LEDGER_FILE,
    EVENT_TYPE_PROPOSED,
    EVENT_TYPE_PLAN_CONTEXT,
    THRESHOLD_PLAN_CONTEXTS,
    THRESHOLD_HOURS,
  },
};

if (require.main === module) {
  main({ cwd: process.cwd(), now: new Date() }, { stdout: process.stdout });
  process.exit(0);
}
