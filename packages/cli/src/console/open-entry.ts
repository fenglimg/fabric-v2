// ---------------------------------------------------------------------------
// `POST /api/open` — reveal a knowledge entry's markdown file in the OS default
// application.
//
// This is the console's first write endpoint. It exists in the shell task on
// purpose: a write channel with no caller cannot be verified end to end, and the
// tests for "POST only" / "loopback Origin only" would otherwise be exercising a
// placeholder rather than the path that ships. A capability that is built but
// never wired passes typecheck, lint and its own tests while doing nothing.
//
// Attack surface: the request carries a knowledge ID, never a path. The path is
// looked up from collectStoreCanonicalEntries, i.e. the same enumeration the
// read endpoints use, so "which files may be opened" is a closed set rather than
// a validation rule that has to be written correctly. A client-supplied path
// with a prefix check would be one traversal trick away from an arbitrary-file
// opener; a client-supplied id has nothing to traverse.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { platform } from "node:os";

import { collectStoreCanonicalEntries } from "@fenglimg/fabric-server";

export type OpenResult =
  | { ok: true; file: string }
  | { ok: false; status: number; error: string };

/** Injectable so tests assert the dispatch without launching a real program. */
export type Opener = (file: string) => void;

function systemOpener(file: string): void {
  const [command, args] =
    platform() === "darwin"
      ? ["open", [file]]
      : platform() === "win32"
        ? ["cmd", ["/c", "start", "", file]]
        : ["xdg-open", [file]];
  spawn(command as string, args as string[], { stdio: "ignore", detached: true }).unref();
}

export async function openKnowledgeEntry(
  projectRoot: string,
  qualifiedId: unknown,
  opener: Opener = systemOpener,
): Promise<OpenResult> {
  if (typeof qualifiedId !== "string" || qualifiedId.length === 0) {
    return { ok: false, status: 400, error: "qualifiedId is required" };
  }
  // `allStores: true` so an entry visible on the console's cross-store view can
  // be opened from it. Anything narrower would make the button work on some rows
  // and silently fail on others depending on the source toggle.
  const entries = await collectStoreCanonicalEntries(projectRoot, { allStores: true });
  const match = entries.find((e) => e.qualifiedId === qualifiedId);
  if (match === undefined) {
    // Deliberately does not echo the id back or say whether any store was
    // searched — an unknown id is an unknown id.
    return { ok: false, status: 404, error: "unknown entry" };
  }
  try {
    opener(match.file);
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return { ok: true, file: match.file };
}
