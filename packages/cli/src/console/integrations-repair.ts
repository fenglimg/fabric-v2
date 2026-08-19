// ---------------------------------------------------------------------------
// The console's ONE write channel for the install tree.
//
// Everything on the integrations page is read from the filesystem, so the fix
// for everything on it is "run the command that writes that tree again". This
// module is that button, and it is deliberately not more:
//
//   1. TWO ACTIONS, ENUMERATED. `install` and `doctor --fix` — the same two
//      commands the page's own copy tells you to run. The action is matched
//      against this table before anything is spawned, so a request cannot name
//      a third command, a flag, or a shell fragment. Argument vectors are built
//      here, never assembled from the request.
//   2. THE REQUEST NEVER CARRIES A PATH. It names a scope id; the path comes
//      from the same `resolveScope` the read side uses. This is the rule the
//      config write channel and the scope switcher already follow, and the
//      reason a repair cannot be aimed at a directory the user never opened.
//   3. MACHINE SCOPE HAS NO REPAIR. There is no machine-wide install tree to
//      write, so the request is refused rather than silently retargeted at the
//      launch directory.
//
// Output streams back as plain text while the child runs. Not because streaming
// is nicer, but because these two commands take tens of seconds and rewrite the
// files the user is looking at: a spinner that ends in "done" gives them no way
// to tell a repair that worked from one that printed six warnings.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import type { ServerResponse } from "node:http";

import { resolveScope } from "./scope.js";

/** The only commands this endpoint can run. */
const ACTIONS = {
  install: ["install", "--yes"],
  // `--yes` because the child has no TTY to answer doctor's confirm on, and a
  // repair that hangs forever on an invisible prompt is worse than one that
  // refuses to run.
  "doctor-fix": ["doctor", "--fix", "--yes"],
} as const;

export type RepairAction = keyof typeof ACTIONS;

export function isRepairAction(value: unknown): value is RepairAction {
  return typeof value === "string" && Object.hasOwn(ACTIONS, value);
}

export interface RepairRequest {
  action?: unknown;
  scope?: unknown;
}

/**
 * Everything that must hold before a child process exists.
 *
 * Separate from the spawn so the guard is testable without running `install`,
 * and so the refusals are ordinary JSON — the streaming response only starts
 * once the request is known to be legal.
 */
export type RepairPlan =
  | {
      ok: true;
      action: RepairAction;
      /**
       * Argument vector for `process.execPath`, entry script included.
       *
       * The entry is resolved HERE rather than inside the spawn so that the two
       * halves stay separable: the planner is the part that must never let an
       * untrusted string through, and the runner is the part that must stream
       * correctly. A test can exercise the streaming on a harmless vector
       * without a CLI build in the way.
       */
      argv: string[];
      cwd: string;
    }
  | { ok: false; status: number; error: string };

export async function planRepair(
  body: RepairRequest | null,
  launchDir: string,
): Promise<RepairPlan> {
  const action = body?.action;
  if (!isRepairAction(action)) {
    return {
      ok: false,
      status: 400,
      error: `unknown action: expected one of ${Object.keys(ACTIONS).join(", ")}`,
    };
  }

  const scope = typeof body?.scope === "string" ? body.scope : null;
  const resolved = await resolveScope(scope, launchDir);
  if (!resolved.ok) return { ok: false, status: resolved.status, error: resolved.error };
  if (resolved.scope.kind === "machine") {
    return { ok: false, status: 400, error: "machine scope has no install tree to repair" };
  }

  // The CLI re-invokes ITSELF (`process.argv[1]`) rather than resolving `fabric`
  // on PATH: the console is served by one particular build, and a globally
  // installed older copy repairing the tree this build's templates describe is
  // exactly the drift the page exists to report.
  return {
    ok: true,
    action,
    argv: [process.argv[1] as string, ...ACTIONS[action]],
    cwd: resolved.scope.projectRoot,
  };
}

/** Run the planned command, streaming its combined output to `res` as it comes. */
export function runRepair(plan: Extract<RepairPlan, { ok: true }>, res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    // Chunks have to reach the browser while the child is still running; a
    // buffering proxy would turn this back into a spinner.
    "x-content-type-options": "nosniff",
  });

  const child = spawn(process.execPath, plan.argv, {
    cwd: plan.cwd,
    // Inherit nothing: the child must not read the console's stdin, and both
    // its streams are the response body.
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });

  child.stdout.on("data", (c: Buffer) => res.write(c));
  child.stderr.on("data", (c: Buffer) => res.write(c));
  child.on("error", (err) => res.end(`\n[fabric] ${plan.action} failed to start: ${err.message}\n`));
  // The exit code goes in the body, not the status: the status was already sent
  // with the first chunk. A trailer line the page can match on is the only way
  // a streamed response can still report failure.
  child.on("close", (code) => res.end(`\n[fabric] ${plan.action} exited with code ${code ?? -1}\n`));
}
