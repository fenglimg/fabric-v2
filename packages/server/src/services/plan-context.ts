import {
  loadGetRulesContext,
  normalizeRulesPath,
  resolveRulesForPath,
  type RulesPayload,
} from "./get-rules.js";

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
};

export async function planContext(
  projectRoot: string,
  input: PlanContextInput,
): Promise<PlanContextResult> {
  const context = await loadGetRulesContext(projectRoot);
  const stale = input.client_hash !== undefined && input.client_hash !== context.meta.revision;
  const uniquePaths = dedupePaths(input.paths);
  const entries = await Promise.all(
    uniquePaths.map(async (path) => ({
      path,
      rules: await resolveRulesForPath(projectRoot, context, path, { dedupeByPath: true }),
    })),
  );

  return {
    revision_hash: context.meta.revision,
    stale,
    entries,
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
