// v2.2 MC5-action-hint (W3-T3): symmetric payload-warning surfacing across every
// MCP tool. The api-contracts structuredWarningSchema has carried `action_hint`
// since R24, but the tools applied it ASYMMETRICALLY: plan_context /
// fab_get_knowledge_sections / fab_recall / fab_archive_scan surfaced a
// soft-warn banner with a hint, while fab_extract_knowledge / fab_review called
// enforcePayloadLimit and DISCARDED its result — so a near-limit response from
// those two told the agent nothing. This helper converges all of them onto one
// shape: when the guard flags an over-warn payload, append a structured warning
// with a tool-specific `action_hint`; otherwise no-op.

import { type PayloadGuardResult } from "@fenglimg/fabric-shared/node/mcp-payload-guard";

export interface StructuredToolWarning {
  code: string;
  file: string;
  line?: number;
  action_hint: string;
}

/**
 * Append a soft payload-size warning (with `actionHint`) to `warnings` when the
 * guard flagged one. Returns the (possibly extended) array — undefined stays
 * undefined when there is nothing to add, preserving the minimal wire shape.
 *
 * Overloaded so a caller with a REQUIRED `warnings` array (e.g.
 * fab_get_knowledge_sections always carries one) gets back a non-undefined
 * array, while a caller with an OPTIONAL array keeps the optional return.
 */
export function appendPayloadWarning<T extends StructuredToolWarning>(
  warnings: T[],
  guardResult: PayloadGuardResult,
  actionHint: string,
): T[];
export function appendPayloadWarning<T extends StructuredToolWarning>(
  warnings: T[] | undefined,
  guardResult: PayloadGuardResult,
  actionHint: string,
): T[] | undefined;
export function appendPayloadWarning<T extends StructuredToolWarning>(
  warnings: T[] | undefined,
  guardResult: PayloadGuardResult,
  actionHint: string,
): T[] | undefined {
  if (guardResult.warning === undefined) {
    return warnings;
  }
  const warning = {
    code: guardResult.warning.code,
    file: "<response>",
    action_hint: actionHint,
  } as T;
  return [...(warnings ?? []), warning];
}
