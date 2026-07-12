import { spawnSync } from "node:child_process";

import type { Translator } from "@fenglimg/fabric-shared";

import type { DoctorCheck } from "./doctor-types.js";

// rc.35 TASK-04 (P0-9.b): global_cli_outdated inspection.
//
// rc.31 introduced an `.fabric/agents.meta.json` schema fix that is
// incompatible with rc.30-and-earlier global CLI installs. This lint spawns
// `fabric -v` on PATH, parses the version, and emits a manual_error when the
// binary is older than the minimum supported version. ENOENT and other
// spawn-time failures degrade to warn so doctor itself can still complete.
const MIN_SUPPORTED_GLOBAL_CLI_VERSION = "2.0.0-rc.31";

export type GlobalCliInspection =
  | { status: "ok"; version: string }
  | { status: "outdated"; version: string; minVersion: string }
  | { status: "not-found" }
  | { status: "unparseable"; detail: string };

type GlobalCliSpawnResult = {
  error?: NodeJS.ErrnoException | Error | null;
  status?: number | null;
  stdout?: string;
};

// Injectable for tests; production passes the default spawnSync wrapper.
type GlobalCliSpawnFn = () => GlobalCliSpawnResult;

const defaultGlobalCliSpawn: GlobalCliSpawnFn = () => {
  const res = spawnSync("fabric", ["-v"], {
    encoding: "utf8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  return { error: res.error ?? null, status: res.status, stdout: res.stdout };
};

export function inspectGlobalCliVersion(
  spawn: GlobalCliSpawnFn = defaultGlobalCliSpawn,
): GlobalCliInspection {
  let res: GlobalCliSpawnResult;
  try {
    res = spawn();
  } catch (e) {
    return { status: "unparseable", detail: e instanceof Error ? e.message : String(e) };
  }
  if (res.error) {
    if ((res.error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "not-found" };
    }
    return { status: "unparseable", detail: res.error.message };
  }
  if (res.status !== 0) {
    return { status: "unparseable", detail: `exit ${res.status ?? "?"}` };
  }
  const raw = (res.stdout ?? "").trim();
  // Accept both prereleases ("2.2.0-rc.1") and GA releases ("2.0.1", no -rc).
  const m = /(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?/.exec(raw);
  if (!m) {
    return { status: "unparseable", detail: raw.slice(0, 80) };
  }
  const hasRc = m[4] !== undefined;
  const version = hasRc ? `${m[1]}.${m[2]}.${m[3]}-rc.${m[4]}` : `${m[1]}.${m[2]}.${m[3]}`;
  // Full-semver precedence: compare base (major.minor.patch) before rc suffix.
  // A GA release outranks any prerelease of the same base, so model its rc as
  // +Infinity.
  const minM = /(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?/.exec(MIN_SUPPORTED_GLOBAL_CLI_VERSION);
  const observed = [Number(m[1]), Number(m[2]), Number(m[3]), hasRc ? Number(m[4]) : Infinity];
  const min = minM
    ? [Number(minM[1]), Number(minM[2]), Number(minM[3]), minM[4] !== undefined ? Number(minM[4]) : Infinity]
    : [0, 0, 0, 0];
  const diffAt = observed.findIndex((v, i) => v !== min[i]);
  if (diffAt !== -1 && observed[diffAt] < min[diffAt]) {
    return { status: "outdated", version, minVersion: MIN_SUPPORTED_GLOBAL_CLI_VERSION };
  }
  return { status: "ok", version };
}

export function createGlobalCliVersionCheck(
  t: Translator,
  inspection: GlobalCliInspection,
): DoctorCheck {
  if (inspection.status === "ok") {
    return {
      name: t("doctor.check.global_cli_outdated.name"),
      status: "ok",
      message: t("doctor.check.global_cli_outdated.ok", { version: inspection.version }),
    };
  }
  if (inspection.status === "outdated") {
    return {
      name: t("doctor.check.global_cli_outdated.name"),
      status: "error",
      kind: "manual_error",
      code: "global_cli_outdated",
      message: t("doctor.check.global_cli_outdated.message.outdated", {
        version: inspection.version,
        minVersion: inspection.minVersion,
      }),
      actionHint: t("doctor.check.global_cli_outdated.remediation"),
      fixable: false,
    };
  }
  if (inspection.status === "not-found") {
    return {
      name: t("doctor.check.global_cli_outdated.name"),
      status: "warn",
      kind: "warning",
      code: "global_cli_not_found",
      message: t("doctor.check.global_cli_outdated.message.not_found"),
      actionHint: t("doctor.check.global_cli_outdated.remediation"),
      fixable: false,
    };
  }
  return {
    name: t("doctor.check.global_cli_outdated.name"),
    status: "warn",
    kind: "warning",
    code: "global_cli_unparseable",
    message: t("doctor.check.global_cli_outdated.message.unparseable", { detail: inspection.detail }),
    actionHint: t("doctor.check.global_cli_outdated.remediation"),
    fixable: false,
  };
}
