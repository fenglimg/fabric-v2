# { projectName } — L0 AGENTS.md

<!-- This is the fallback template. If you have Claude Code, run the agents-md-init skill for a semantically richer AGENTS.md. -->

This file is the non-AI fallback scaffold for a Cocos Creator codebase. Prefer conservative edits and preserve editor-generated assets.

<!-- fab:index -->
<!-- /fab:index -->

## Human Documentation References

- `README.md` is the source of truth for gameplay intent, scene flow, setup, and packaging steps.
- Cocos Editor settings, prefab wiring, and scene structure are human-reviewed surfaces; ask before broad refactors.
- When code and editor data disagree, inspect both before changing either side.

## L0 AI Constraints

- Component scripts must follow the existing Cocos pattern: import from `cc`, destructure decorators from `_decorator`, apply `@ccclass`, and extend `Component`.
- Respect Cocos lifecycle order. Put initialization in `onLoad` or `start`, cleanup in `onDestroy`, and keep `update` lightweight and frame-safe.
- Do not mark `update()` as `async` and do not introduce blocking or network-heavy work into frame callbacks.
- Preserve `.meta` files, prefab references, scene bindings, and asset UUID relationships unless the task explicitly requires coordinated editor changes.
- Prefer targeted script edits over renaming assets, moving prefab trees, or restructuring `assets/` folders.

## Cocos Baseline

- Keep gameplay logic inside component boundaries or small helpers that are already imported by components.
- When adding new nodes or serialized fields, match the repository's existing decorator and property style.
- Validate with the smallest relevant TypeScript or project command first; only ask for editor-side verification when asset wiring changes.

## @HUMAN

- Human-owned decisions belong in this section or `.fabric/human-lock.json`; AI must pause before changing them.
- Record protected scenes, prefabs, release assets, or multiplayer protocol invariants here.

## L1 Candidate Notes

- Add scoped AGENTS.md files only for large subtrees such as `assets/scripts`, `assets/prefabs`, or `assets/scenes` when they gain distinct local rules.
