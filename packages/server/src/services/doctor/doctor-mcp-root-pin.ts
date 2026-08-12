import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  inspectManagedRootPin,
  repairManagedRootPin,
  type RootPinInspection,
  type Translator,
} from "@fenglimg/fabric-shared";

import type { DoctorCheck } from "../doctor-types.js";
import { issueCheck, okCheck } from "./doctor-check-helpers.js";

// ---------------------------------------------------------------------------
// mcp_root_pin_managed — a `FABRIC_PROJECT_ROOT` pin an OLD fabric installer
// wrote into an MCP client config, and that today's installer would not write.
//
// Current policy is dynamic root resolution (see `createServerEntry`): the
// client spawns the server with an uncontrolled cwd and the server works the
// root out at runtime. An installer-era pin freezes whatever root that one
// install ran in, and nothing ever revisits it. Two ways that bites:
//
//   * the pin is in USER scope (`~/.claude.json`, `~/.codex/config.toml`), so
//     every other repo on the machine also gets pointed at this one project —
//     silent cross-project reads and writes;
//   * the pin is in PROJECT scope but the directory moved (or a teammate
//     cloned elsewhere), so the pin now names a path this checkout is not at.
//
// Only the `managed` state is reported. `explicit` (`operator:v1`/`project:v1`)
// is a human's deliberate pin and `ambiguous` is one whose authorship we cannot
// prove — a client config is user territory, so we touch neither (KT-GLD-0016).
//
// Severity splits on whether the pin still names THIS project: a pin that
// happens to be correct today is a latent hazard (warning), a pin naming some
// other path is actively wrong (error). Crying "error" over a pin that is
// currently working would train users to ignore the check.
//
// Unlike the sibling `install_copy_drift`, this one DOES promise a --fix
// (KT-PIT-0016 cuts both ways): the repair is removing an env key from a config
// file, which needs no CLI templates, so `packages/server` can reach it. The
// repair itself lives in shared next to the inspector, and takes a verified
// backup before writing.
// ---------------------------------------------------------------------------

/** Client kinds an installer could have stamped into a marker digest. */
const CLIENT_KINDS = ["ClaudeCodeCLI", "ClaudeCodeDesktop", "CodexCLI"] as const;

export type ManagedRootPin = {
  /** Absolute path of the client config carrying the pin. */
  configPath: string;
  /** The pinned project root, as written. */
  pinnedRoot: string;
  /** Whether that root still resolves to the project doctor is inspecting. */
  matchesProject: boolean;
  /** Client kind whose digest the marker matched — how the pin was recognised. */
  clientKind: string;
};

export type McpRootPinInspection = {
  /** Config files that existed and were readable. */
  scanned: number;
  /** Managed pins found, sorted by config path. */
  pins: ManagedRootPin[];
};

/**
 * Every client config that could hold a fabric MCP registration. Project scope
 * first so a doctor report names the file closest to the user's checkout.
 */
function candidateConfigs(projectRoot: string, homeDir: string): string[] {
  return [
    join(projectRoot, ".mcp.json"),
    join(homeDir, ".claude.json"),
    join(homeDir, ".codex", "config.toml"),
  ];
}

/**
 * Classify one config's fabric entry. The installer marker is a digest OVER the
 * client kind, so recognising a pin means trying each kind — a config path does
 * not tell us which installer wrote it, and guessing wrong turns a real managed
 * pin into an unreportable `ambiguous`.
 */
function inspectConfig(
  configPath: string,
  raw: string,
): { inspection: RootPinInspection; clientKind: string } | null {
  for (const clientKind of CLIENT_KINDS) {
    let inspection: RootPinInspection;
    try {
      inspection = inspectManagedRootPin({ clientKind, raw, configPath });
    } catch {
      // Unparseable config (or one that is not JSON/TOML at all). Not this
      // check's business — `hooks_wired` owns config parseability.
      return null;
    }
    if (inspection.state === "managed") return { inspection, clientKind };
  }
  return null;
}

/**
 * `homeDir` is injectable purely so tests stay hermetic: two of the three
 * candidate configs live in the real user home, and a check whose result
 * depends on the developer's own machine is a check that goes red for reasons
 * that have nothing to do with the change under test.
 */
export async function inspectMcpRootPins(
  projectRoot: string,
  opts: { homeDir?: string } = {},
): Promise<McpRootPinInspection> {
  const normalizedProject = resolve(projectRoot);
  const pins: ManagedRootPin[] = [];
  let scanned = 0;

  for (const configPath of candidateConfigs(projectRoot, opts.homeDir ?? homedir())) {
    let raw: string;
    try {
      raw = await readFile(configPath, "utf8");
    } catch {
      continue;
    }
    scanned += 1;
    const found = inspectConfig(configPath, raw);
    if (found === null || found.inspection.root === undefined) continue;
    pins.push({
      configPath,
      pinnedRoot: found.inspection.root,
      matchesProject: resolve(found.inspection.root) === normalizedProject,
      clientKind: found.clientKind,
    });
  }

  pins.sort((a, b) => a.configPath.localeCompare(b.configPath));
  return { scanned, pins };
}

export function createMcpRootPinCheck(
  t: Translator,
  inspection: McpRootPinInspection,
): DoctorCheck {
  const name = t("doctor.check.mcp_root_pin.name");

  if (inspection.pins.length === 0) {
    // Deliberately does NOT report how many configs were scanned: two of the
    // three candidates live in the user's home, so a count would make this
    // message — and the doctor snapshot that locks it — differ per machine.
    return okCheck(name, t("doctor.check.mcp_root_pin.ok.clean"));
  }

  const stale = inspection.pins.filter((pin) => !pin.matchesProject);
  const worst = stale[0] ?? inspection.pins[0];
  return issueCheck(
    name,
    stale.length > 0 ? "error" : "warn",
    stale.length > 0 ? "fixable_error" : "warning",
    "mcp_root_pin_managed",
    t(
      stale.length > 0
        ? "doctor.check.mcp_root_pin.message.stale"
        : "doctor.check.mcp_root_pin.message.aligned",
      {
        count: String(inspection.pins.length),
        config: worst.configPath,
        pinned: worst.pinnedRoot,
      },
    ),
    t("doctor.check.mcp_root_pin.remediation"),
  );
}

export type McpRootPinFixResult = {
  /** Config paths whose managed pin was removed. */
  repaired: string[];
  /** Config paths where the repair was attempted and threw (config restored). */
  failed: string[];
};

/**
 * Remove every installer-managed pin found. Each repair takes a verified backup
 * first and restores the original on any write failure, so a partial run leaves
 * every config either fully repaired or byte-identical to before.
 */
export async function fixMcpRootPins(
  inspection: McpRootPinInspection,
): Promise<McpRootPinFixResult> {
  const repaired: string[] = [];
  const failed: string[] = [];
  for (const pin of inspection.pins) {
    // Reuse the clientKind the inspection matched: the marker is a digest over
    // it, so re-deriving it here could disagree with what we reported and turn
    // the repair into a silent no-op.
    try {
      const result = await repairManagedRootPin({
        configPath: pin.configPath,
        clientKind: pin.clientKind,
      });
      if (result.changed) repaired.push(pin.configPath);
    } catch {
      failed.push(pin.configPath);
    }
  }
  return { repaired, failed };
}
