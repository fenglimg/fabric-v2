import {
  buildRulesPayload,
  loadGetRulesContext,
  loadMatchedRules,
  matchRuleNodes,
  normalizeRulesPath,
  type RulesPayload,
  type SharedDescriptionStub,
} from "./get-rules.js";
import { sha256 } from "./_shared.js";

export type PlanContextInput = {
  paths: string[];
  client_hash?: string;
};

export type PlanContextResult = {
  revision_hash: string;
  stale: boolean;
  entries: Array<{
    path: string;
    rules: RulesPayload;
  }>;
  shared: {
    resolved_bundle_id: string;
    shared_entries: Array<{
      stable_id: string;
      identity_source: "declared" | "derived";
      level: "L1" | "L2";
      path: string;
      content: string;
    }>;
    file_map: Record<
      string,
      {
        L1: string[];
        L2: string[];
        description_stubs: string[];
      }
    >;
    description_stub_union: SharedDescriptionStub[];
    preflight_diagnostics: Array<{
      code: "description_stub_only" | "derived_identity";
      severity: "info" | "warn";
      message: string;
      path?: string;
      stable_ids?: string[];
    }>;
  };
};

export async function planContext(
  projectRoot: string,
  input: PlanContextInput,
): Promise<PlanContextResult> {
  const context = await loadGetRulesContext(projectRoot);
  const stale = input.client_hash !== undefined && input.client_hash !== context.meta.revision;
  const uniquePaths = dedupePaths(input.paths);
  const fileContentCache = new Map<string, Promise<string>>();
  const matchedNodesByPath = new Map(
    uniquePaths.map((path) => [path, matchRuleNodes(context.meta, path)]),
  );
  const loadedByPath = new Map(
    await Promise.all(
      uniquePaths.map(async (path) => [
        path,
        await loadMatchedRules(projectRoot, matchedNodesByPath.get(path) ?? [], fileContentCache),
      ] as const),
    ),
  );
  const entries = uniquePaths.map((path) => ({
    path,
    rules: buildRulesPayload(context, loadedByPath.get(path) ?? { rules: [], stubs: [] }, {
      dedupeByPath: true,
    }),
  }));
  const shared = buildSharedView(context.meta.revision, uniquePaths, matchedNodesByPath, loadedByPath);

  return {
    revision_hash: context.meta.revision,
    stale,
    entries,
    shared,
  };
}

function dedupePaths(paths: string[]): string[] {
  const seenPaths = new Set<string>();

  return paths.flatMap((path) => {
    const normalizedPath = normalizeRulesPath(path);

    if (seenPaths.has(normalizedPath)) {
      return [];
    }

    seenPaths.add(normalizedPath);
    return [normalizedPath];
  });
}

function buildSharedView(
  revision: string,
  uniquePaths: string[],
  matchedNodesByPath: Map<string, ReturnType<typeof matchRuleNodes>>,
  loadedByPath: Map<string, Awaited<ReturnType<typeof loadMatchedRules>>>,
): PlanContextResult["shared"] {
  const sharedEntriesByStableId = new Map<string, PlanContextResult["shared"]["shared_entries"][number]>();
  const descriptionStubByStableId = new Map<string, SharedDescriptionStub>();
  const derivedStableIds = new Set<string>();
  const bundleStableIds = new Set<string>();

  const fileMap = Object.fromEntries(
    uniquePaths.map((path) => {
      const matchedNodes = matchedNodesByPath.get(path) ?? [];
      const loaded = loadedByPath.get(path) ?? { rules: [], stubs: [] };
      const l1 = collectPerPathStableIds(loaded.rules, "L1");
      const l2 = collectPerPathStableIds(loaded.rules, "L2");
      const descriptionStubs = dedupeStableIds(loaded.stubs.map((stub) => stub.stable_id));

      for (const matchedNode of matchedNodes) {
        bundleStableIds.add(matchedNode.stable_id);
        if (matchedNode.identity_source === "derived") {
          derivedStableIds.add(matchedNode.stable_id);
        }
      }

      for (const rule of loaded.rules) {
        sharedEntriesByStableId.set(rule.stable_id, {
          stable_id: rule.stable_id,
          identity_source: rule.identity_source,
          level: rule.level,
          path: rule.entry.path,
          content: rule.entry.content,
        });
      }

      for (const stub of loaded.stubs) {
        descriptionStubByStableId.set(stub.stable_id, stub);
      }

      return [
        path,
        {
          L1: l1,
          L2: l2,
          description_stubs: descriptionStubs,
        },
      ];
    }),
  );

  const descriptionStubUnion = Array.from(descriptionStubByStableId.values()).sort(compareStableIds);
  const sharedEntries = Array.from(sharedEntriesByStableId.values()).sort(compareStableIds);
  const preflightDiagnostics: PlanContextResult["shared"]["preflight_diagnostics"] = [];

  for (const path of uniquePaths) {
    const slice = fileMap[path];
    if (slice !== undefined && slice.L1.length === 0 && slice.L2.length === 0 && slice.description_stubs.length > 0) {
      preflightDiagnostics.push({
        code: "description_stub_only",
        severity: "info",
        path,
        stable_ids: slice.description_stubs,
        message:
          `Path ${path} only matched description stubs and no loadable L1/L2 rules. ` +
          "Run fab_get_rules on the final target before editing if you need the full rule text.",
      });
    }
  }

  if (derivedStableIds.size > 0) {
    const stableIds = Array.from(derivedStableIds).sort();
    preflightDiagnostics.push({
      code: "derived_identity",
      severity: "warn",
      stable_ids: stableIds,
      message:
        `Resolved bundle includes ${stableIds.length} rule node${stableIds.length === 1 ? "" : "s"} ` +
        "that still rely on derived identities. Declare `<!-- fab:rule-id ... -->` in the source rule file to stabilize audit references.",
    });
  }

  return {
    resolved_bundle_id: sha256([revision, ...Array.from(bundleStableIds).sort()].join("\n")),
    shared_entries: sharedEntries,
    file_map: fileMap,
    description_stub_union: descriptionStubUnion,
    preflight_diagnostics: preflightDiagnostics,
  };
}

function dedupeStableIds(stableIds: string[]): string[] {
  return Array.from(new Set(stableIds));
}

function collectPerPathStableIds(
  rules: Awaited<ReturnType<typeof loadMatchedRules>>["rules"],
  level: "L1" | "L2",
): string[] {
  const seenPaths = new Set<string>();
  const stableIds: string[] = [];

  for (const rule of rules) {
    if (rule.level !== level || seenPaths.has(rule.entry.path)) {
      continue;
    }

    seenPaths.add(rule.entry.path);
    stableIds.push(rule.stable_id);
  }

  return stableIds;
}

function compareStableIds(
  left: { stable_id: string },
  right: { stable_id: string },
): number {
  return left.stable_id.localeCompare(right.stable_id);
}
