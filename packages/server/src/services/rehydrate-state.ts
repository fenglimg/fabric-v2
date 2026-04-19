import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { agentsMetaSchema, type AgentsMeta, type AgentsMetaNode } from "@fenglimg/fabric-shared";

import { readLedger, type StoredLedgerEntry } from "./read-ledger.js";

const execFileAsync = promisify(execFile);
const AGENTS_META_GIT_PATH = ".fabric/agents.meta.json";

export class HistoryReplayError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HistoryReplayError";
  }
}

export type RehydrateTarget =
  | { ledgerEntryId: string }
  | { timestamp: number };

export type RehydratedAgentsMetaSnapshot = {
  meta: AgentsMeta;
  metadata: {
    at_ledger_id: string;
    at_commit: string | null;
    replayed_count: number;
    mode: "git-show" | "ledger-fallback";
  };
  entries: StoredLedgerEntry[];
};

export async function rehydrateAgentsMetaAt(
  projectRoot: string,
  target: RehydrateTarget,
): Promise<RehydratedAgentsMetaSnapshot> {
  const ledger = await readLedger(projectRoot);
  const selectedIndex = resolveTargetIndex(ledger, target);
  const replayedEntries = ledger.slice(0, selectedIndex + 1);
  const selectedEntry = replayedEntries.at(-1);

  if (selectedEntry === undefined) {
    throw new HistoryReplayError(
      "Cannot rehydrate history state because the ledger is empty.",
      "HISTORY_STATE_NOT_FOUND",
      404,
    );
  }

  const commitCandidates = collectCommitCandidates(replayedEntries);

  for (const commit of commitCandidates) {
    const meta = await tryReadAgentsMetaFromGit(projectRoot, commit);
    if (meta !== null) {
      return {
        meta,
        metadata: {
          at_ledger_id: selectedEntry.id,
          at_commit: commit,
          replayed_count: replayedEntries.length,
          mode: "git-show",
        },
        entries: replayedEntries,
      };
    }
  }

  const fallbackMeta = buildLedgerFallbackMeta(replayedEntries);

  return {
    meta: fallbackMeta,
    metadata: {
      at_ledger_id: selectedEntry.id,
      at_commit: commitCandidates[0] ?? null,
      replayed_count: replayedEntries.length,
      mode: "ledger-fallback",
    },
    entries: replayedEntries,
  };
}

function resolveTargetIndex(ledger: StoredLedgerEntry[], target: RehydrateTarget): number {
  if ("ledgerEntryId" in target) {
    const index = ledger.findIndex((entry) => entry.id === target.ledgerEntryId);

    if (index === -1) {
      throw new HistoryReplayError(
        `Cannot find ledger entry: ${target.ledgerEntryId}`,
        "LEDGER_ENTRY_NOT_FOUND",
        404,
      );
    }

    return index;
  }

  for (let index = ledger.length - 1; index >= 0; index -= 1) {
    if (ledger[index]?.ts <= target.timestamp) {
      return index;
    }
  }

  throw new HistoryReplayError(
    `Cannot find ledger entry at or before timestamp: ${new Date(target.timestamp).toISOString()}`,
    "HISTORY_STATE_NOT_FOUND",
    404,
  );
}

function collectCommitCandidates(entries: StoredLedgerEntry[]): string[] {
  const commits: string[] = [];
  const seen = new Set<string>();

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const commit = entry.source === "ai" ? entry.commit_sha : entry.parent_sha;

    if (typeof commit !== "string" || commit.length === 0 || commit === "root" || seen.has(commit)) {
      continue;
    }

    seen.add(commit);
    commits.push(commit);
  }

  return commits;
}

async function tryReadAgentsMetaFromGit(projectRoot: string, commit: string): Promise<AgentsMeta | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["show", `${commit}:${AGENTS_META_GIT_PATH}`],
      {
        cwd: projectRoot,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      },
    );

    return agentsMetaSchema.parse(JSON.parse(stdout));
  } catch (error) {
    if (isRecoverableGitError(error)) {
      return null;
    }

    throw error;
  }
}

function buildLedgerFallbackMeta(entries: StoredLedgerEntry[]): AgentsMeta {
  const nodes = entries.reduce<Record<string, AgentsMetaNode>>((current, entry) => {
    const hashBase = entry.source === "ai" ? entry.commit_sha ?? entry.id : entry.parent_sha;

    for (const affectedPath of entry.affected_paths) {
      current[affectedPath] = {
        file: affectedPath,
        scope_glob: affectedPath,
        deps: [],
        priority: "medium",
        layer: "L2",
        topology_type: "mirror",
        hash: `replayed:${hashBase ?? entry.id}`,
      };
    }

    return current;
  }, {});

  const lastEntry = entries.at(-1);

  return {
    revision: lastEntry?.source === "ai"
      ? lastEntry.commit_sha ?? `replayed:${lastEntry.id ?? entries.length}`
      : `replayed:${lastEntry?.id ?? entries.length}`,
    nodes,
  };
}

function isRecoverableGitError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const nodeError = error as NodeJS.ErrnoException & { stderr?: string };
  return nodeError.code === "ENOENT" || typeof nodeError.stderr === "string";
}
