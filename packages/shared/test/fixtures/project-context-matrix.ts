import {
  ISOLATED_WORKSPACE_BINDING_ID,
  MAIN_PROJECT_ID,
  UNRELATED_PROJECT_ID,
  type GitFixtureRoot,
} from "../helpers/git-worktree-fixture.js";

export type MatrixClientId = "claude-code" | "claude-desktop" | "codex";
export type MatrixClientKind = "ClaudeCodeCLI" | "ClaudeCodeDesktop" | "CodexCLI";
export type MatrixRootMode = "dynamic" | "pinned";
export type MatrixBindingMode = "inherited" | "isolated";

export interface ProjectContextMatrixCase {
  name: string;
  client: {
    id: MatrixClientId;
    kind: MatrixClientKind;
    label: "Claude Code project" | "Claude Code user" | "Claude Desktop" | "Codex";
    claudeScope?: "project" | "user";
  };
  rootMode: MatrixRootMode;
  roots: GitFixtureRoot[];
  explicitRoot?: GitFixtureRoot;
  workspaceBinding: MatrixBindingMode;
  expected?: {
    workspaceRoot: GitFixtureRoot;
    identityRoot: GitFixtureRoot;
    projectId: string;
    bindingId: string;
    source: "client-root" | "explicit-pin";
  };
  error?: "ambiguous" | "unresolved";
}

export const PROJECT_CONTEXT_MATRIX: readonly ProjectContextMatrixCase[] = [
  {
    name: "Claude Code project dynamic linked inherited",
    client: { id: "claude-code", kind: "ClaudeCodeCLI", label: "Claude Code project", claudeScope: "project" },
    rootMode: "dynamic",
    roots: ["linked"],
    workspaceBinding: "inherited",
    expected: {
      workspaceRoot: "linked",
      identityRoot: "main",
      projectId: MAIN_PROJECT_ID,
      bindingId: MAIN_PROJECT_ID,
      source: "client-root",
    },
  },
  {
    name: "Claude Code project pinned wins over ambiguous roots",
    client: { id: "claude-code", kind: "ClaudeCodeCLI", label: "Claude Code project", claudeScope: "project" },
    rootMode: "pinned",
    roots: ["main", "unrelated"],
    explicitRoot: "linked",
    workspaceBinding: "inherited",
    expected: {
      workspaceRoot: "linked",
      identityRoot: "main",
      projectId: MAIN_PROJECT_ID,
      bindingId: MAIN_PROJECT_ID,
      source: "explicit-pin",
    },
  },
  {
    name: "Claude Code user dynamic linked isolated workspace_binding_id",
    client: { id: "claude-code", kind: "ClaudeCodeCLI", label: "Claude Code user", claudeScope: "user" },
    rootMode: "dynamic",
    roots: ["linked"],
    workspaceBinding: "isolated",
    expected: {
      workspaceRoot: "linked",
      identityRoot: "main",
      projectId: MAIN_PROJECT_ID,
      bindingId: ISOLATED_WORKSPACE_BINDING_ID,
      source: "client-root",
    },
  },
  {
    name: "Claude Code user pinned with zero roots",
    client: { id: "claude-code", kind: "ClaudeCodeCLI", label: "Claude Code user", claudeScope: "user" },
    rootMode: "pinned",
    roots: [],
    explicitRoot: "main",
    workspaceBinding: "inherited",
    expected: {
      workspaceRoot: "main",
      identityRoot: "main",
      projectId: MAIN_PROJECT_ID,
      bindingId: MAIN_PROJECT_ID,
      source: "explicit-pin",
    },
  },
  {
    name: "Claude Desktop dynamic main roots",
    client: { id: "claude-desktop", kind: "ClaudeCodeDesktop", label: "Claude Desktop" },
    rootMode: "dynamic",
    roots: ["main"],
    workspaceBinding: "inherited",
    expected: {
      workspaceRoot: "main",
      identityRoot: "main",
      projectId: MAIN_PROJECT_ID,
      bindingId: MAIN_PROJECT_ID,
      source: "client-root",
    },
  },
  {
    name: "Claude Desktop pinned linked isolated over multiple roots",
    client: { id: "claude-desktop", kind: "ClaudeCodeDesktop", label: "Claude Desktop" },
    rootMode: "pinned",
    roots: ["main", "unrelated"],
    explicitRoot: "linked",
    workspaceBinding: "isolated",
    expected: {
      workspaceRoot: "linked",
      identityRoot: "main",
      projectId: MAIN_PROJECT_ID,
      bindingId: ISOLATED_WORKSPACE_BINDING_ID,
      source: "explicit-pin",
    },
  },
  {
    name: "Codex dynamic roots are ambiguous",
    client: { id: "codex", kind: "CodexCLI", label: "Codex" },
    rootMode: "dynamic",
    roots: ["main", "unrelated"],
    workspaceBinding: "inherited",
    error: "ambiguous",
  },
  {
    name: "Codex dynamic zero roots is unresolved",
    client: { id: "codex", kind: "CodexCLI", label: "Codex" },
    rootMode: "dynamic",
    roots: [],
    workspaceBinding: "inherited",
    error: "unresolved",
  },
  {
    name: "Codex pinned unrelated with zero roots",
    client: { id: "codex", kind: "CodexCLI", label: "Codex" },
    rootMode: "pinned",
    roots: [],
    explicitRoot: "unrelated",
    workspaceBinding: "inherited",
    expected: {
      workspaceRoot: "unrelated",
      identityRoot: "unrelated",
      projectId: UNRELATED_PROJECT_ID,
      bindingId: UNRELATED_PROJECT_ID,
      source: "explicit-pin",
    },
  },
] as const;
