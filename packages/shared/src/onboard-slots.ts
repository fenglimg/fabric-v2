import { z } from "zod";

// ---------------------------------------------------------------------------
// v2.0.0-rc.23 TASK-014 (F8c): S5 onboard-slot mechanism.
//
// After rc.23 F8a removed the auto-`fabric scan` baseline pipeline, a freshly
// installed Fabric workspace ships with an EMPTY `.fabric/knowledge/` tree —
// none of the "project tone" baseline entries (tech stack / module layout /
// build config / etc.) exist until the user explicitly archives them.
//
// F8c reintroduces that "first-time tone capture" surface as a Skill-
// orchestrated onboard PHASE inside fabric-archive (not a CLI auto-scan):
// the LLM checks five fixed `onboard_slot` labels against current canonical
// frontmatter, prompts the user when a slot is unclaimed, and proposes
// pending entries with `onboard_slot: <slot>` set so future runs see the
// slot as filled.
//
// The five slot names are LOCKED via the `grill` design pass. Adding /
// removing / reordering requires schema evolution + a doctor migration —
// downstream code keys off this `as const` tuple for both enum validation
// and stable-iteration order (e.g. `fabric onboard-coverage` table rendering).
// ---------------------------------------------------------------------------

export const ONBOARD_SLOT_NAMES = [
  "tech-stack-decision",
  "architecture-pattern",
  "code-style-tone",
  "build-system-idiom",
  "domain-vocabulary",
] as const;

export type OnboardSlot = (typeof ONBOARD_SLOT_NAMES)[number];

// Zod enum derived from the tuple — single source of truth for both the
// FabExtractKnowledgeInputSchema `onboard_slot` field (api-contracts.ts) and
// CLI side validators (`fabric config dismiss-slot <slot>` arg check).
export const onboardSlotSchema = z.enum(ONBOARD_SLOT_NAMES);

// Convenience: total slot count, mirrored in onboard-coverage output's `total`
// field so consumers can sanity-check the wire payload against the enum.
export const ONBOARD_SLOT_TOTAL = ONBOARD_SLOT_NAMES.length;
