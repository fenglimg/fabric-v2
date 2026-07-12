/**
 * doctor-path.ts — pure path/string helpers for doctor.
 *
 * Wave W1 extraction from doctor.ts (repo-hygiene-slim).
 */
import { isAbsolute, resolve, posix } from "node:path";
import type { DoctorIssue, DoctorReport } from "./doctor-types.js";

export function createFixMessage(fixed: DoctorIssue[], report: DoctorReport): string {
  const fixedText = fixed.length === 0
    ? "No deterministic doctor fixes were needed."
    : `Applied ${fixed.length} deterministic doctor fix${fixed.length === 1 ? "" : "es"}.`;
  const manualText = report.manual_errors.length === 0
    ? "No manual errors remain."
    : `${report.manual_errors.length} manual error${report.manual_errors.length === 1 ? "" : "s"} remain.`;

  return `${fixedText} ${manualText}`;
}


export function isValidJsonLine(line: string): boolean {
  try {
    JSON.parse(line) as unknown;
    return true;
  } catch {
    return false;
  }
}


export function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}


export function normalizePath(path: string): string {
  return posix.normalize(path.split("\\").join("/"));
}

