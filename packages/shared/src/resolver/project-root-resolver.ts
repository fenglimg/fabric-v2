// Compatibility facade. Project context/root resolution is owned by the shared
// worktree-aware resolver module.
export {
  createProjectRootResolver,
  resolveProjectRoot,
} from "./project-context-resolver.js";
