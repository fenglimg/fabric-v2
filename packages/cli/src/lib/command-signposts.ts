/**
 * Tombstone / signpost layer for retired top-level CLI names.
 * Prints successor guidance and exits non-zero — NEVER silent aliases.
 */
export type CommandSignpost = {
  retired: string;
  successor: string;
  /** Optional extra note (prefer successor-only for i18n-clean messages). */
  note?: string;
};

export const RETIRED_COMMAND_SIGNPOSTS: ReadonlyArray<CommandSignpost> = [
  { retired: "metrics", successor: "fabric audit metrics" },
  { retired: "context", successor: "fabric inspect" },
  { retired: "whoami", successor: "fabric info" },
  { retired: "status", successor: "fabric info" },
  { retired: "scope-explain", successor: "fabric info scope" },
];

const BY_NAME = new Map(RETIRED_COMMAND_SIGNPOSTS.map((s) => [s.retired, s]));

export function resolveSignpost(name: string | undefined): CommandSignpost | null {
  if (!name || name.startsWith("-")) return null;
  return BY_NAME.get(name) ?? null;
}

/** Template should already be localized; do not append English notes (BP-014). */
export function formatSignpostMessage(
  signpost: CommandSignpost,
  template: (retired: string, successor: string) => string,
): string {
  return template(signpost.retired, signpost.successor);
}
