/**
 * The result vocabulary every `fabric install` writer speaks.
 *
 * Its own module because both directions of the dependency need it: the
 * writers under `install/` produce these rows, and `write-bootstrap-snapshot.ts`
 * — which those writers import from — produces them too. Keeping the type in
 * either writer module made that pair import each other in a cycle.
 */

// rc.14 TASK-002: diff-mode classification.
//   - "written"         : a write occurred (created or overwrote).
//   - "skipped"         : destination already matches canonical (no write).
//   - "error"           : the step failed.
//   - "drift"           : destination exists but content diverges from canonical
//                         (detected only when InstallOptions.detectDrift is set);
//                         the diff-mode caller is expected to abort the run.
//   - "missing-managed" : a managed file was deleted by the user and is being
//                         restored. Treated like "written" by most consumers
//                         (it is a write); the distinct label lets diff-mode
//                         reporting list which files were restored vs. freshly
//                         created.
export type InstallStepStatus =
  | "written"
  | "skipped"
  | "error"
  | "drift"
  | "missing-managed";

export type InstallStepResult = {
  step: string;
  path: string;
  status: InstallStepStatus;
  message?: string;
};
