import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
  type GlobalConfig,
} from "@fenglimg/fabric-shared";

import { createSelectionToken, planContext } from "./plan-context.js";
import { readEventLedger } from "./event-ledger.js";
import { extractBody, getKnowledgeSections } from "./knowledge-sections.js";
import { computeReadSetRevision } from "./cross-store-recall.js";
import { contextCache } from "../cache.js";

// v2.2 W5 R3+R7 (读侧退役): getKnowledgeSections no longer reads the project's
// co-location `.fabric/agents.meta.json`. Every selected id is resolved through
// buildCrossStoreBodyIndex against the MOUNTED stores in the read-set, and the
// body is read straight from the store file. Selected ids must be
// store-qualified (`team:KT-DEC-0001` / `personal:KP-...`); a bare colon-less id
// no longer matches any store entry → it lands in an `unresolved_selected_id`
// diagnostic (warn-skip) instead of throwing.
//
// FABRIC_HOME is repointed to an isolated fake home in beforeEach so the
// developer's real ~/.fabric/stores never leak into the fixture, and the seeded
// stores land under that fake home.

// v2.0-rc.7 T9: planContext() always emits a selection_token, but the token it
// mints carries `required_stable_ids = []`. The two-stage selection tests below
// still need a token that ENFORCES specific required ids, so they mint a fresh
// token directly via createSelectionToken with the test-supplied lists rather
// than reusing plan.selection_token. The candidate paths come from the plan so
// the token's target_paths stay consistent with the planning surface.
function mintTokenFromPlan(
  plan: Awaited<ReturnType<typeof planContext>>,
  requiredStableIds: string[],
  aiSelectableStableIds: string[],
): string {
  return createSelectionToken(
    plan.revision_hash,
    plan.entries.map((entry) => entry.path),
    requiredStableIds,
    aiSelectableStableIds,
  );
}

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

// Fixed store UUIDs reused across the fixtures below. The team store backs the
// required_stores read-set; the personal store is auto-included via its
// `personal: true` flag (S11 implicit personal).
const TEAM_STORE = "11111111-1111-4111-8111-111111111111";
const PERSONAL_STORE = "22222222-2222-4222-8222-222222222222";

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-knowledge-sections-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
  contextCache.invalidate("file_watch");
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

// v2.0.0-rc.23 TASK-013 (F8b): `parseKnowledgeSections` (and the 4-element
// A-set enum it indexed) was retired. The replacement `extractBody` strips a
// YAML frontmatter block and returns the raw markdown — callers scan whatever
// B-set heading layout the rule defines.
describe("extractBody", () => {
  it("strips a leading YAML frontmatter block and returns the body unchanged", () => {
    const body = extractBody(`---
summary: Pool rules
type: decision
---
# 规则：对象池规范

## Summary
本脚本只负责资源池生命周期。

## Mandatory
必须在 onDestroy 中执行 unuse 逻辑。
`);
    expect(body.startsWith("# 规则：对象池规范")).toBe(true);
    expect(body).toContain("## Summary");
    expect(body).toContain("## Mandatory");
    expect(body).not.toContain("summary: Pool rules");
  });

  it("returns the full content unchanged when no frontmatter is present", () => {
    const source = "# Heading\n\n## Body\nplain markdown\n";
    expect(extractBody(source)).toBe(source);
  });

  it("strips a leading UTF-8 BOM even when frontmatter is absent", () => {
    const body = extractBody(`﻿# Heading\n\nbody\n`);
    expect(body.charCodeAt(0)).not.toBe(0xfeff);
    expect(body.startsWith("# Heading")).toBe(true);
  });

  // W2-08 (ISS-017): extractBody is now a SINGLE shared implementation
  // (_shared.ts), re-exported here and imported by review.ts. It returns the
  // body UNTRIMMED; the trim policy is per-consumer (review applies `.trim()`
  // at its list/search call sites). This locks the unified semantics so the
  // two call sites can't silently re-fork.
  it("returns the body UNTRIMMED (consumers trim explicitly) — single shared impl", () => {
    const source = `---\nid: KT-DEC-0001\n---\n  ## Body with surrounding whitespace  \n\n`;
    const body = extractBody(source);
    // Untrimmed: the body's own leading spaces and trailing newlines are kept.
    expect(body).toBe("  ## Body with surrounding whitespace  \n\n");
    // review's trimmed surface is exactly the shared result .trim()'d.
    expect(body.trim()).toBe("## Body with surrounding whitespace");
  });
});

describe("getKnowledgeSections", () => {
  // W3-06 (ISS-035): a missing/expired selection_token must fail with an
  // actionable recovery hint (re-run fab_plan_context) reaching the MCP client.
  it("rejects a missing/expired selection_token with a fab_plan_context recovery hint", async () => {
    const projectRoot = await createSectionProject();
    let err: unknown;
    try {
      await getKnowledgeSections(projectRoot, {
        selection_token: "selection:bogus-never-minted",
        ai_selected_stable_ids: [],
        ai_selection_reasons: {},
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    // The hint must be in the message (the only field the MCP SDK serializes).
    expect((err as Error).message).toMatch(/fab_plan_context/);
    expect((err as { actionHint?: string }).actionHint).toMatch(/fab_plan_context/);
  });

  it("skips a selected store-qualified id absent from the read-set instead of crashing (F7)", async () => {
    const projectRoot = await createSectionProject();
    const plan = await planContext(projectRoot, { paths: ["assets/scripts/ui/BattleView.ts"] });
    // `team:KT-DEC-9999` is in the token's selectable set but has NO entry in any
    // mounted store — it must be skipped with a diagnostic, never throw and crash
    // the whole call. The valid store id `team:KT-GLD-0001` is still delivered.
    const selectionToken = mintTokenFromPlan(plan, [], ["team:KT-GLD-0001", "team:KT-DEC-9999"]);

    const result = await getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
      ai_selected_stable_ids: ["team:KT-GLD-0001", "team:KT-DEC-9999"],
      ai_selection_reasons: {
        "team:KT-GLD-0001": "valid store pick",
        "team:KT-DEC-9999": "store entry the AI also chose",
      },
      correlation_id: "corr-f7",
      session_id: "session-f7",
    });

    // The valid store rule is still delivered; the missing store id is skipped.
    expect(result.rules.map((r) => r.stable_id)).toEqual(["team:KT-GLD-0001"]);
    const unresolved = result.diagnostics.filter((d) => d.code === "unresolved_selected_id");
    expect(unresolved.map((d) => d.stable_id)).toEqual(["team:KT-DEC-9999"]);
    expect(unresolved[0]!.severity).toBe("warn");
  });

  it("keeps a selection token usable across read-set revision changes until TTL expiry (ISS-061)", async () => {
    const projectRoot = await createSectionProject();
    const plan = await planContext(projectRoot, { paths: ["assets/scripts/ui/BattleView.ts"] });
    const selectionToken = mintTokenFromPlan(plan, [], ["team:KT-GLD-0001"]);
    const beforeRevision = await computeReadSetRevision(projectRoot);

    await writeStoreEntry(TEAM_STORE, "guidelines", {
      id: "KT-GLD-0001",
      type: "guideline",
      summary: "UI batch rendering after revision change",
      body: "## [MANDATORY_INJECTION]\nUI mandatory after revision change.",
    });

    const afterRevision = await computeReadSetRevision(projectRoot);
    expect(beforeRevision).toBe(plan.revision_hash);
    expect(afterRevision).not.toBe(beforeRevision);

    const result = await getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
      ai_selected_stable_ids: ["team:KT-GLD-0001"],
      ai_selection_reasons: {
        "team:KT-GLD-0001": "Selection remains valid while the token TTL has not expired.",
      },
      correlation_id: "corr-iss-061",
      session_id: "session-iss-061",
    });

    expect(result.revision_hash).toBe(afterRevision);
    expect(result.rules.map((r) => r.stable_id)).toEqual(["team:KT-GLD-0001"]);
    expect(result.rules[0]!.body).toContain("UI mandatory after revision change.");
  });

  it("merges required ids with AI-selected ids and returns store-backed bodies", async () => {
    const projectRoot = await createSectionProject();
    const plan = await planContext(projectRoot, { paths: ["assets/scripts/ui/BattleView.ts"] });
    const selectionToken = mintTokenFromPlan(
      plan,
      ["team:KT-DEC-0001", "team:KT-DEC-0002"],
      ["team:KT-GLD-0001"],
    );

    const result = await getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
      ai_selected_stable_ids: ["team:KT-GLD-0001"],
      ai_selection_reasons: {
        "team:KT-GLD-0001": "BattleView.ts touches UI rendering nodes and labels.",
      },
      correlation_id: "corr-sections",
      session_id: "session-sections",
    });

    // v2.2 W5 R3: revision_hash is now the store-corpus content fingerprint
    // (computeReadSetRevision) — assert shape only, not a literal.
    expect(result.revision_hash).toEqual(expect.any(String));
    expect(result.revision_hash.length).toBeGreaterThan(0);
    // Final order = [required..., ai_selected...].
    expect(result.selected_stable_ids).toEqual([
      "team:KT-DEC-0001",
      "team:KT-DEC-0002",
      "team:KT-GLD-0001",
    ]);
    // v2.0.0-rc.23 TASK-013 (F8b): the API returns the full markdown body
    // (frontmatter stripped). We assert shape + signature substrings.
    expect(result.rules.map((r) => r.stable_id)).toEqual([
      "team:KT-DEC-0001",
      "team:KT-DEC-0002",
      "team:KT-GLD-0001",
    ]);
    expect(result.rules[0]!.body).toContain("# KT-DEC-0001");
    expect(result.rules[0]!.body).toContain("Global mandatory.");
    expect(result.rules[1]!.body).toContain("# KT-DEC-0002");
    expect(result.rules[1]!.body).toContain("BattleView owns combat UI lifecycle boundaries.");
    expect(result.rules[2]!.body).toContain("# KT-GLD-0001");
    expect(result.rules[2]!.body).toContain("UI mandatory.");
    // v2.2 W5 R3: the project-meta `missing_knowledge_metadata` diagnostic is
    // gone (it lived on the co-location node-table path). Store-backed reads
    // surface no metadata diagnostic — every selected id resolved cleanly.
    expect(result.diagnostics).toEqual([]);
    // v2.0 rc.5 TASK-014 (C5): event ledger receives knowledge_consumed events
    // (one per resolved stable_id, deduped per request) after
    // knowledge_sections_fetched. Use slice/find rather than a brittle exact-
    // array match.
    const allEvents = (await readEventLedger(projectRoot)).events;
    const lifecycleEvents = allEvents.filter(
      (e) => e.event_type !== "knowledge_consumed",
    );
    expect(lifecycleEvents).toEqual([
      expect.objectContaining({
        event_type: "knowledge_context_planned",
        target_paths: ["assets/scripts/ui/BattleView.ts"],
      }),
      expect.objectContaining({
        event_type: "knowledge_selection",
        selection_token: selectionToken,
        target_paths: ["assets/scripts/ui/BattleView.ts"],
        required_stable_ids: ["team:KT-DEC-0001", "team:KT-DEC-0002"],
        ai_selectable_stable_ids: ["team:KT-GLD-0001"],
        ai_selected_stable_ids: ["team:KT-GLD-0001"],
        final_stable_ids: ["team:KT-DEC-0001", "team:KT-DEC-0002", "team:KT-GLD-0001"],
        ai_selection_reasons: {
          "team:KT-GLD-0001": "BattleView.ts touches UI rendering nodes and labels.",
        },
        correlation_id: "corr-sections",
        session_id: "session-sections",
      }),
      expect.objectContaining({
        event_type: "knowledge_sections_fetched",
        selection_token: selectionToken,
        target_paths: ["assets/scripts/ui/BattleView.ts"],
        // rc.23 F8b: `requested_sections` is now always emitted as []
        // (the `sections` input parameter was removed).
        requested_sections: [],
        final_stable_ids: ["team:KT-DEC-0001", "team:KT-DEC-0002", "team:KT-GLD-0001"],
        ai_selected_stable_ids: ["team:KT-GLD-0001"],
        diagnostics: result.diagnostics,
        correlation_id: "corr-sections",
        session_id: "session-sections",
      }),
    ]);
    const consumed = allEvents.filter((e) => e.event_type === "knowledge_consumed");
    expect(consumed).toHaveLength(3);
    expect(
      consumed.map((e) => (e as { stable_id: string }).stable_id).sort(),
    ).toEqual(["team:KT-DEC-0001", "team:KT-DEC-0002", "team:KT-GLD-0001"]);
  });

  // -----------------------------------------------------------------------
  // v2.0 rc.5 TASK-014 (C5): knowledge_consumed event emission + dedupe
  // -----------------------------------------------------------------------

  it("emits one knowledge_consumed event per resolved stable_id with client_hash + consumed_at", async () => {
    const projectRoot = await createSectionProject();
    const plan = await planContext(projectRoot, { paths: ["assets/scripts/ui/BattleView.ts"] });
    const selectionToken = mintTokenFromPlan(
      plan,
      ["team:KT-DEC-0001", "team:KT-DEC-0002"],
      ["team:KT-GLD-0001"],
    );

    const before = Date.now();
    await getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
      ai_selected_stable_ids: ["team:KT-GLD-0001"],
      ai_selection_reasons: { "team:KT-GLD-0001": "BattleView touches UI rendering." },
      correlation_id: "corr-consume",
      session_id: "session-consume",
      client_hash: "rev-sections",
    });
    const after = Date.now();

    const { events } = await readEventLedger(projectRoot);
    const consumed = events.filter((e) => e.event_type === "knowledge_consumed");
    expect(consumed).toHaveLength(3);

    const stableIds = consumed
      .map((e) => (e as { stable_id: string }).stable_id)
      .sort();
    expect(stableIds).toEqual(["team:KT-DEC-0001", "team:KT-DEC-0002", "team:KT-GLD-0001"]);

    for (const event of consumed) {
      const e = event as {
        client_hash: string;
        consumed_at: string;
        session_id?: string;
        correlation_id?: string;
      };
      expect(e.client_hash).toBe("rev-sections");
      expect(e.session_id).toBe("session-consume");
      expect(e.correlation_id).toBe("corr-consume");
      const ts = Date.parse(e.consumed_at);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    }
  });

  it("dedupes knowledge_consumed within a single request — duplicate stable_ids emit once", async () => {
    // For a 3-rule fetch we must see exactly 3 events (not 4+): the service
    // builds selected_stable_ids by [required, ...ai_selected] and dedupes on a
    // Set keyed by stable_id, so a single id maps to a single event.
    const projectRoot = await createSectionProject();
    const plan = await planContext(projectRoot, { paths: ["assets/scripts/ui/BattleView.ts"] });
    const selectionToken = mintTokenFromPlan(
      plan,
      ["team:KT-DEC-0001", "team:KT-DEC-0002"],
      ["team:KT-GLD-0001"],
    );

    await getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
      ai_selected_stable_ids: ["team:KT-GLD-0001"],
      ai_selection_reasons: { "team:KT-GLD-0001": "UI." },
      client_hash: "rev-sections",
    });

    const { events } = await readEventLedger(projectRoot);
    const consumed = events.filter((e) => e.event_type === "knowledge_consumed");
    // 3 distinct stable_ids resolved, 3 events — never more, never duplicates.
    expect(consumed).toHaveLength(3);
    const distinct = new Set(consumed.map((e) => (e as { stable_id: string }).stable_id));
    expect(distinct.size).toBe(3);
  });

  it("knowledge_consumed falls back to empty client_hash when caller omits it", async () => {
    const projectRoot = await createSectionProject();
    const plan = await planContext(projectRoot, { paths: ["assets/scripts/ui/BattleView.ts"] });
    const selectionToken = mintTokenFromPlan(
      plan,
      ["team:KT-DEC-0001", "team:KT-DEC-0002"],
      ["team:KT-GLD-0001"],
    );

    await getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
      ai_selected_stable_ids: ["team:KT-GLD-0001"],
      ai_selection_reasons: { "team:KT-GLD-0001": "UI." },
      // No client_hash passed — service should default to "".
    });

    const { events } = await readEventLedger(projectRoot);
    const consumed = events.filter((e) => e.event_type === "knowledge_consumed");
    expect(consumed).toHaveLength(3);
    for (const event of consumed) {
      expect((event as { client_hash: string }).client_hash).toBe("");
    }
  });

  it("hard-errors invalid selections; AI selection reasons are optional (F8)", async () => {
    const projectRoot = await createSectionProject();
    const plan = await planContext(projectRoot, { paths: ["assets/scripts/ui/BattleView.ts"] });
    const selectionToken = mintTokenFromPlan(
      plan,
      ["team:KT-DEC-0001", "team:KT-DEC-0002"],
      ["team:KT-GLD-0001"],
    );

    await expect(getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
      ai_selected_stable_ids: ["team:not-selectable"],
      ai_selection_reasons: { "team:not-selectable": "not selectable" },
    })).rejects.toThrow(/Invalid rule selection/u);

    // v2.2 全砍 F8: omitting a reason for a VALID selection no longer throws —
    // ai_selection_reasons is optional audit telemetry (matches the schema's
    // `.optional().default({})` contract). The body is delivered regardless.
    const noReason = await getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
      ai_selected_stable_ids: ["team:KT-GLD-0001"],
      ai_selection_reasons: {},
    });
    expect(noReason.selected_stable_ids).toContain("team:KT-GLD-0001");

    // A required id is not in the token's ai_selectable set → selecting it as an
    // AI pick is still rejected.
    await expect(getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
      ai_selected_stable_ids: ["team:KT-DEC-0001"],
      ai_selection_reasons: { "team:KT-DEC-0001": "cannot be AI-selected." },
    })).rejects.toThrow(/Invalid rule selection/u);
  });

  it("hard-errors missing or expired selection tokens", async () => {
    const projectRoot = await createSectionProject();

    await expect(getKnowledgeSections(projectRoot, {
      selection_token: "missing",
      ai_selected_stable_ids: [],
      ai_selection_reasons: {},
    })).rejects.toThrow(/selection_token is missing or expired/u);
  });

  it("delivers every selected store id deterministically in [required, ...ai_selected] order", async () => {
    const projectRoot = await createSectionProject({ extraGuideline: true });
    const plan = await planContext(projectRoot, { paths: ["assets/scripts/ui/BattleView.ts"] });
    const selectionToken = mintTokenFromPlan(
      plan,
      ["team:KT-DEC-0001", "team:KT-DEC-0002"],
      ["team:KT-GLD-0001", "team:KT-GLD-0002"],
    );

    const result = await getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
      ai_selected_stable_ids: ["team:KT-GLD-0002", "team:KT-GLD-0001"],
      ai_selection_reasons: {
        "team:KT-GLD-0002": "Also touches UI rendering.",
        "team:KT-GLD-0001": "Primary UI rendering rule.",
      },
    });
    // Required ids come first (token order), then ai-selected ids in the order
    // the caller supplied them.
    expect(result.selected_stable_ids).toEqual([
      "team:KT-DEC-0001",
      "team:KT-DEC-0002",
      "team:KT-GLD-0002",
      "team:KT-GLD-0001",
    ]);
  });

  // ---------------------------------------------------------------------------
  // v2.2 W5 R3: a bare (colon-less) id is no longer a hard throw. With the
  // co-location node table retired, a bare id matches no store entry → it is
  // warn-skipped via the unresolved_selected_id diagnostic, and any valid
  // store-qualified ids in the same call are still delivered.
  // ---------------------------------------------------------------------------

  it("warn-skips a bare colon-less id (no store match) instead of throwing", async () => {
    const projectRoot = await createSectionProject();
    const plan = await planContext(projectRoot, { paths: ["assets/scripts/ui/BattleView.ts"] });
    // `legacy-bare-id` is selectable in the token but is NOT store-qualified, so
    // buildCrossStoreBodyIndex never resolves it → unresolved diagnostic. The
    // store-qualified id alongside it is still delivered.
    const selectionToken = mintTokenFromPlan(
      plan,
      [],
      ["team:KT-GLD-0001", "legacy-bare-id"],
    );

    const result = await getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
      ai_selected_stable_ids: ["team:KT-GLD-0001", "legacy-bare-id"],
      ai_selection_reasons: {
        "team:KT-GLD-0001": "valid store pick",
        "legacy-bare-id": "un-qualified legacy id",
      },
    });

    expect(result.rules.map((r) => r.stable_id)).toEqual(["team:KT-GLD-0001"]);
    const unresolved = result.diagnostics.filter((d) => d.code === "unresolved_selected_id");
    expect(unresolved.map((d) => d.stable_id)).toEqual(["legacy-bare-id"]);
    expect(unresolved[0]!.severity).toBe("warn");
    // No missing_knowledge_metadata diagnostic (project-meta path retired).
    expect(result.diagnostics.some((d) => d.code === "missing_knowledge_metadata")).toBe(false);
  });

  it("resolves a personal-store id alongside team ids (implicit personal read-set)", async () => {
    const projectRoot = await createSectionProject({ personal: true });
    const plan = await planContext(projectRoot, { paths: ["assets/scripts/ui/BattleView.ts"] });
    const selectionToken = mintTokenFromPlan(
      plan,
      ["team:KT-DEC-0001"],
      ["personal:KP-GLD-0001"],
    );

    const result = await getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
      ai_selected_stable_ids: ["personal:KP-GLD-0001"],
      ai_selection_reasons: { "personal:KP-GLD-0001": "personal style pick" },
    });

    expect(result.selected_stable_ids).toEqual(["team:KT-DEC-0001", "personal:KP-GLD-0001"]);
    const personalRule = result.rules.find((r) => r.stable_id === "personal:KP-GLD-0001");
    expect(personalRule?.body).toContain("# KP-GLD-0001");
    expect(result.diagnostics).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Store fixture helpers (mirror plan-context.test.ts). createSectionProject
// seeds a team store (and optionally a personal store) with the entries the
// getKnowledgeSections tests select, writes the project's fabric-config.json
// declaring the team store as required, and mounts the stores in the global
// config. NO .fabric/agents.meta.json is written — the read side is store-only.
// ---------------------------------------------------------------------------

type StoreEntryFields = {
  id: string;
  summary: string;
  type?: string;
  layer?: "team" | "personal";
  body?: string;
};

/** Render a full-frontmatter knowledge .md body for a store entry. */
function entryMd(f: StoreEntryFields): string {
  const layer = f.layer ?? "team";
  return [
    "---",
    `id: ${f.id}`,
    `type: ${f.type ?? "decision"}`,
    `layer: ${layer}`,
    "semantic_scope: team",
    `visibility_store: "${layer}"`,
    "maturity: proven",
    "created_at: 2026-06-04T00:00:00.000Z",
    `summary: ${f.summary}`,
    "---",
    "",
    `# ${f.id}`,
    "",
    f.body ?? `Body for ${f.id}.`,
    "",
  ].join("\n");
}

/** Write a knowledge .md into a store under the isolated ~/.fabric. */
async function writeStoreEntry(
  storeUuid: string,
  type: string,
  f: StoreEntryFields,
): Promise<void> {
  const dir = join(
    resolveGlobalRoot(),
    storeRelativePathForMount({ store_uuid: storeUuid, personal: storeUuid === PERSONAL_STORE }),
    STORE_LAYOUT.knowledgeDir,
    type,
  );
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${f.id}.md`), entryMd({ type: type.replace(/s$/u, ""), ...f }));
}

async function createSectionProject(
  options: { extraGuideline?: boolean; personal?: boolean } = {},
): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-knowledge-sections-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
  );

  // Team store entries.
  await writeStoreEntry(TEAM_STORE, "decisions", {
    id: "KT-DEC-0001",
    summary: "Global protocol",
    body: "## [MANDATORY_INJECTION]\nGlobal mandatory.",
  });
  await writeStoreEntry(TEAM_STORE, "decisions", {
    id: "KT-DEC-0002",
    summary: "BattleView local decision",
    body: [
      "## [MISSION_STATEMENT]",
      "BattleView owns combat UI lifecycle boundaries.",
      "",
      "## [BUSINESS_LOGIC_CHUNKS]",
      "### ID: BL-BATTLE-001",
      "- **Anchor**: `BL-BATTLE-001`",
      "- **Intent**: Avoid flicker when tabs switch quickly.",
    ].join("\n"),
  });
  await writeStoreEntry(TEAM_STORE, "guidelines", {
    id: "KT-GLD-0001",
    type: "guideline",
    summary: "UI batch rendering",
    body: "## [MANDATORY_INJECTION]\nUI mandatory.\n\n## [CONTEXT_INFO]\nUI context.",
  });
  if (options.extraGuideline === true) {
    await writeStoreEntry(TEAM_STORE, "guidelines", {
      id: "KT-GLD-0002",
      type: "guideline",
      summary: "UI low priority guideline",
      body: "## [MANDATORY_INJECTION]\nUI low mandatory.",
    });
  }

  const stores: GlobalConfig["stores"] = [
    { store_uuid: TEAM_STORE, alias: "team", remote: "git@e:team.git" },
  ];

  if (options.personal === true) {
    await writeStoreEntry(PERSONAL_STORE, "guidelines", {
      id: "KP-GLD-0001",
      type: "guideline",
      layer: "personal",
      summary: "Personal coding style",
      body: "## [MANDATORY_INJECTION]\nPersonal mandatory.",
    });
    stores.push({
      store_uuid: PERSONAL_STORE,
      alias: "personal",
      remote: "git@e:personal.git",
      personal: true,
    });
  }

  saveGlobalConfig({ uid: "test-uid", stores });

  return projectRoot;
}
