/**
 * Shared doctor check constructors (W7).
 * Pure helpers used by create*Check factories across doctor modules.
 */
import type { DoctorCheck, DoctorIssueKind, DoctorStatus } from "./doctor-types.js";

export function okCheck(name: string, message: string): DoctorCheck {
  return { name, status: "ok", message };
}

export function issueCheck(
  name: string,
  status: DoctorStatus,
  kind: DoctorIssueKind,
  code: string,
  message: string,
  actionHint?: string,
  audience?: "user" | "maintainer",
): DoctorCheck {
  return {
    name,
    status,
    kind,
    code,
    fixable: kind === "fixable_error",
    message,
    actionHint,
    audience,
  };
}