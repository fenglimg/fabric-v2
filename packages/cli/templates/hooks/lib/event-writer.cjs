// ux-w2-9: the SINGLE guarded events.jsonl write path for .cjs hooks.
//
// Before this, every hook (knowledge-hint-broad / fabric-hint / post-tooluse-
// mutation) hand-stamped the event envelope (kind/id/ts/schema_version) and
// called appendLockedLine directly. A forgotten field or a non-string event_type
// produced a row the doctor's event-ledger Zod read (event_ledger_schema_compat)
// would reject. This module centralizes the stamp + guard so every cjs-written
// row satisfies the same envelope contract the TS appendEventLedgerEvent enforces
// via Zod — without pulling Zod into the no-build .cjs runtime.
//
// Contract (mirrors eventLedgerEventSchema's envelope):
//   - event_type MUST be a non-empty string (the discriminator). Missing/blank →
//     the event is REJECTED (returns false), never written.
//   - kind / schema_version are FORCED to the ledger constants.
//   - id / ts are stamped only when absent (caller may pre-stamp for determinism).
//   - Never throws — hooks must never block; a write failure returns false.

const { join } = require("node:path");
const { appendLockedLine } = require("./injection-log.cjs");

const EVENT_KIND = "fabric-event";
const SCHEMA_VERSION = 1;

function safeUuid() {
  try {
    // eslint-disable-next-line global-require
    return require("node:crypto").randomUUID();
  } catch {
    // crypto unavailable (exotic runtime) → time+rand fallback, still unique enough.
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

// Stamp the canonical envelope onto a caller event, or return null when the event
// fails the guard (not an object / missing event_type). Pure (no I/O).
function stampEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  if (typeof event.event_type !== "string" || event.event_type.length === 0) return null;
  return {
    ...event,
    kind: EVENT_KIND,
    schema_version: SCHEMA_VERSION,
    id: typeof event.id === "string" && event.id.length > 0 ? event.id : `event:${safeUuid()}`,
    ts: typeof event.ts === "number" ? event.ts : Date.now(),
  };
}

// Append ONE guarded event line to <fabricDir>/events.jsonl. Returns true on a
// successful write, false if the event failed the guard or the append errored.
function appendEvent(fabricDir, event) {
  const stamped = stampEvent(event);
  if (stamped === null) return false;
  try {
    appendLockedLine(join(fabricDir, "events.jsonl"), JSON.stringify(stamped) + "\n");
    return true;
  } catch {
    return false;
  }
}

// Append MANY guarded events in a SINGLE locked write (preserves the batched
// append the post-tooluse hook relied on). Invalid events are dropped; returns
// the count actually written. A zero-valid batch performs no write.
function appendEvents(fabricDir, events) {
  if (!Array.isArray(events)) return 0;
  const stamped = events.map(stampEvent).filter((e) => e !== null);
  if (stamped.length === 0) return 0;
  try {
    appendLockedLine(
      join(fabricDir, "events.jsonl"),
      stamped.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
    return stamped.length;
  } catch {
    return 0;
  }
}

module.exports = { appendEvent, appendEvents, stampEvent };
