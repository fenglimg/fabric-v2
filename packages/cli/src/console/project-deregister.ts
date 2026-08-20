// ---------------------------------------------------------------------------
// `POST /api/projects/deregister` — forget a project this machine knows about.
//
// The console's second irreversible capability, and the more dangerous of the
// two: `/api/cleanup` removes files Fabric itself left behind, while this
// removes the machine's memory of a project. It follows `/api/cleanup`'s rules
// and adds one.
//
//   1. THE REQUEST NEVER NAMES A LOCATION. It carries a row KEY, which the
//      server matches against a freshly merged project list; every deletion is
//      then computed from the MATCHED ROW's own fields. A key that no row has
//      resolves to nothing, so the endpoint cannot be pointed at anything the
//      page did not just display (KT-PIT-0106).
//   2. THE PLAN IS COMPUTED BY THE SAME CODE THAT EXECUTES IT. `plan()` is the
//      preview the user confirms; `apply()` calls it and deletes exactly what
//      it returned. A separate "what would happen" implementation would drift
//      from the real one and the drift would only surface after the delete.
//   3. NOTHING HAPPENS WITHOUT `confirm`. An unconfirmed request is a pure
//      read — that is what makes "the user cancelled and the disk is unchanged"
//      true by construction rather than by careful coding.
//
// Three places hold a project, and they hold DIFFERENT amounts of it:
//
//   ~/.fabric/state/projects.json    the directory it was installed in
//   fabric-global.json `projects[id]` its per-project setting overrides
//   ~/.fabric/state/bindings/*.json  its resolved store bindings
//
// A project is normally in some but not all of them, so the plan is per-project
// rather than a fixed list of three deletions. What it cannot do is reach a
// project that was not named: every arm is keyed on the matched row.
//
// The cost is stated to the user before they confirm, because it is not
// recoverable by re-running anything: knowledge this project archived into a
// store stays in the store, but nothing connects it to this project any more,
// so it stops surfacing here.
// ---------------------------------------------------------------------------

import { unlink } from "node:fs/promises";

import { findBindingsForProject } from "../store/bindings-io.js";
import { mutateGlobalConfig, resolveGlobalRoot } from "../store/global-config-io.js";
import {
  deregisterProjectById,
  deregisterProjectByPath,
} from "../store/project-registry-io.js";
import { asPlainObject } from "./config-resolve.js";
import { collectKnownProjects, type MergedProject } from "./project-list.js";
import { loadGlobalConfig } from "../store/global-config-io.js";

export interface DeregisterRequest {
  /** A row key from `/api/config`'s project list — never a bare directory. */
  key?: unknown;
  /** Absent or false means "tell me what this would do", and nothing is written. */
  confirm?: unknown;
}

/** One thing that will be (or was) removed, named the way the user sees it. */
export interface DeregisterItem {
  where: "registry" | "config" | "bindings";
  /** The concrete location — a directory, a config segment, or a file. */
  detail: string;
}

export interface DeregisterPlan {
  key: string;
  name: string;
  items: DeregisterItem[];
}

export type DeregisterResult =
  | { ok: true; confirmed: false; plan: DeregisterPlan }
  | {
      ok: true;
      confirmed: true;
      plan: DeregisterPlan;
      removed: DeregisterItem[];
      /**
       * How many projects the SAME merge still finds, re-read from disk. A
       * count derived as `before - 1` would report success for a removal that
       * silently did nothing (KT-PIT-0107).
       */
      remainingCount: number;
    }
  | { ok: false; status: number; error: string };

function bad(status: number, error: string): { ok: false; status: number; error: string } {
  return { ok: false, status, error };
}

/**
 * What removing `row` would touch, in the order it will be touched.
 *
 * Only arms that actually have something are listed: a `config-only` project has
 * no registry entry, and a project that never bound a store has no snapshot.
 * Listing an arm that would delete nothing would make the confirmation dialog
 * overstate the damage, and a dialog that overstates gets skimmed.
 */
async function buildPlan(row: MergedProject): Promise<DeregisterPlan> {
  const items: DeregisterItem[] = [];

  if (row.path !== null && row.origin !== "config-only" && row.origin !== "current-only") {
    items.push({ where: "registry", detail: row.path });
  }
  if (row.projectId !== null) {
    const global = asPlainObject(loadGlobalConfig(resolveGlobalRoot()));
    if (row.projectId in asPlainObject(global.projects)) {
      items.push({ where: "config", detail: `projects.${row.projectId}` });
    }
    for (const file of findBindingsForProject(row.projectId)) {
      items.push({ where: "bindings", detail: file });
    }
  }

  return { key: row.key, name: row.name, items };
}

/**
 * @param launchDir the directory the console was started in. It selects nothing
 * — it is passed only so the list this endpoint matches against is the same list
 * `/api/config` rendered, including the synthesized row for an unregistered
 * current project (KT-PIT-0106).
 */
export async function applyProjectDeregister(
  body: DeregisterRequest | null,
  launchDir: string,
): Promise<DeregisterResult> {
  const key = body?.key;
  if (typeof key !== "string" || key.length === 0) {
    return bad(400, "key is required");
  }

  const before = await collectKnownProjects(launchDir);
  const row = before.find((p) => p.key === key);
  if (row === undefined) {
    return bad(404, `not a known project: ${key}`);
  }
  if (row.isCurrent) {
    // Forgetting the project the console is running in would delete the
    // settings governing the page you are looking at, and the very next read
    // would re-synthesize the row from the launch directory — so it would also
    // look like it had failed.
    return bad(409, "cannot deregister the project the console is running in");
  }

  const plan = await buildPlan(row);
  if (body?.confirm !== true) {
    return { ok: true, confirmed: false, plan };
  }

  const removed: DeregisterItem[] = [];
  for (const item of plan.items) {
    if (item.where === "registry") {
      const paths =
        row.projectId === null
          ? ((await deregisterProjectByPath(item.detail)) ? [item.detail] : [])
          : await deregisterProjectById(row.projectId);
      if (paths.includes(item.detail)) removed.push(item);
    } else if (item.where === "config") {
      const projectId = row.projectId;
      if (projectId === null) continue;
      let dropped = false;
      // Read-modify-write inside one lock. Loading outside and saving inside is
      // how a concurrent writer's change gets silently overwritten here
      // (KT-PIT-0055), and this is the file every other console write also
      // touches.
      await mutateGlobalConfig((current) => {
        if (current === null) return null;
        const projects = (current as { projects?: Record<string, unknown> }).projects;
        if (projects === undefined || !(projectId in projects)) return null;
        delete projects[projectId];
        dropped = true;
        return current;
      });
      if (dropped) removed.push(item);
    } else {
      try {
        await unlink(item.detail);
        removed.push(item);
      } catch {
        // Reported by absence from `removed`, and by a remainingCount that did
        // not move — not by pretending it worked.
      }
    }
  }

  const after = await collectKnownProjects(launchDir);
  return { ok: true, confirmed: true, plan, removed, remainingCount: after.length };
}
