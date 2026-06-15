import { z } from "zod";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P0 — Two-client parity matrix contract (CONTRACT part of
// S14/S29; the E2E VERIFICATION that drives off this matrix is P5).
//
// Each row = one capability × the two supported clients' EXPECTED state.
// This file front-loads the contract so P4 develops client adapters AGAINST a
// fixed baseline and P5 only executes the matrix as 100%-green E2E cases — no
// "build first, align later" inversion (roadmap-v4 changelog ①).
//
// Supported clients are LOCKED to two (memory/project_fabric_scope.md):
// Claude Code, Codex CLI. (A third client was removed 2026-06-15 — clean-slate
// per the zero-user policy.) The matrix expresses MECHANISM differences (event
// names / payload / cwd / session-id, S6) while keeping `supported: true`
// across the board.
//
// Pure definition layer: schema + a stub `parity-matrix.json` validated against
// it. No client adapter runs here.
// ---------------------------------------------------------------------------

export const PARITY_CLIENTS = ["claudeCode", "codexCLI"] as const;
export const parityClientSchema = z.enum(PARITY_CLIENTS);
export type ParityClient = z.infer<typeof parityClientSchema>;

// The extension surface a capability belongs to.
export const PARITY_SURFACES = ["skill", "hook", "mcp", "render"] as const;
export const paritySurfaceSchema = z.enum(PARITY_SURFACES);
export type ParitySurface = z.infer<typeof paritySurfaceSchema>;

// Expected state of one capability on one client. `supported` is the E2E
// assertion target (P5). `mechanism` documents the client-specific wiring
// (e.g. the hook event name) so behavioral differences are explicit, not
// silently glossed. `notes` carries any caveat the adapter author must honor.
export const parityClientExpectationSchema = z
  .object({
    supported: z.boolean(),
    mechanism: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();

export type ParityClientExpectation = z.infer<typeof parityClientExpectationSchema>;

// One capability row × all clients. Every client MUST have an explicit
// expectation entry (no implicit defaults) so the matrix is exhaustive and the
// P5 E2E pass can iterate it deterministically.
export const parityCapabilitySchema = z
  .object({
    id: z.string().min(1),
    surface: paritySurfaceSchema,
    description: z.string().min(1),
    clients: z
      .object({
        claudeCode: parityClientExpectationSchema,
        codexCLI: parityClientExpectationSchema,
      })
      .strict(),
  })
  .strict();

export type ParityCapability = z.infer<typeof parityCapabilitySchema>;

export const parityMatrixSchema = z
  .object({
    // Schema/version tag of the matrix document itself.
    version: z.string().min(1),
    // Free-form note on what release/milestone this matrix targets.
    generated_for: z.string().min(1),
    capabilities: z.array(parityCapabilitySchema).min(1),
  })
  .strict();

export type ParityMatrix = z.infer<typeof parityMatrixSchema>;
