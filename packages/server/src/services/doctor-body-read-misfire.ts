// Body-read misfire probe (KT-DEC-0030 / ISS-20260711-221 / W8 extract).
// Binary silence check: sustained knowledge_context_planned with zero
// knowledge_body_read → PostToolUse Read marker likely unwired.

import { readEventLedger } from "./event-ledger.js";

export type BodyReadMisfireReport = {
  recalls: number;
  body_reads: number;
  status: "ok" | "warn";
  message: string;
};

const BODY_READ_MISFIRE_MIN_RECALLS = 10;

export async function runDoctorBodyReadMisfireCheck(
  projectRoot: string,
): Promise<BodyReadMisfireReport> {
  const { events } = await readEventLedger(projectRoot);
  let recalls = 0;
  let bodyReads = 0;
  for (const event of events) {
    if (event.event_type === "knowledge_context_planned") {
      recalls += 1;
    } else if (event.event_type === "knowledge_body_read") {
      bodyReads += 1;
    }
  }

  if (recalls < BODY_READ_MISFIRE_MIN_RECALLS) {
    return {
      recalls,
      body_reads: bodyReads,
      status: "ok",
      message:
        `Only ${String(recalls)} recall(s) on record (< ${String(BODY_READ_MISFIRE_MIN_RECALLS)}) — ` +
        `not enough activity to assess knowledge_body_read wiring.`,
    };
  }

  if (bodyReads === 0) {
    return {
      recalls,
      body_reads: 0,
      status: "warn",
      message:
        `${String(recalls)} recall(s) surfaced read-paths but ZERO knowledge_body_read events — ` +
        `the PostToolUse Read marker may be unwired. Check the PostToolUse matcher includes ` +
        `\`Read\` in .claude/settings.json (and the codex equivalent), then rerun \`fabric install\`.`,
    };
  }

  return {
    recalls,
    body_reads: bodyReads,
    status: "ok",
    message: `knowledge_body_read wiring healthy (${String(bodyReads)} body read(s) across ${String(recalls)} recall(s)).`,
  };
}
