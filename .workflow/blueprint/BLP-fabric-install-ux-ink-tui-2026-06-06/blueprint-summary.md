---
session_id: BLP-fabric-install-ux-ink-tui-2026-06-06
generated_at: 2026-06-06T05:00:00Z
status: complete
quality_score: 91
gate: PASS
---

# Blueprint Summary: Fabric CLI Install/Uninstall UX Refactoring

## One-Page Executive Summary

### Problem
Fabric CLI 的 install/uninstall 流程功能解耦良好，但用户体验存在引导断层。`fabric install` 完成后无明确下一步指引，`fabric store *` 命令让用户无所适从，CLI 输出缺乏视觉锚点和交互连贯性。

### Solution
采用 **ink TUI 方案**（React for CLI），重构 install 为 **7 阶段智能引导流程**，补充 uninstall 对称性清理，统一输出层为 React 组件化 TUI。

### Scope
| Feature | Priority | Description |
|---------|----------|-------------|
| Install Stage Refactor | MUST | 7 discrete, idempotent stages |
| Ink Output Layer | MUST | OutputRenderer abstraction |
| Store Onboarding Wizard | MUST | Skip/Join/Create paths |
| Uninstall Symmetry | MUST | store-binding-cleanup |
| Visual Anchor System | SHOULD | Step counter, separators |
| Summary Card | SHOULD | ≤15 lines boxen card |
| Error Presentation | SHOULD | Recovery-first boxes |
| Progress Feedback | MAY | Spinner + timing |

### Architecture
```
ink@^4.0.0 + @inkjs/ui@^2.0.0
    ↓
OutputRenderer (统一抽象)
    ↓
7 Install Stages: Preflight → Env → Store → Hooks → MCP → Validate → Guidance
    ↓
State Machine (XState 驱动)
```

### MVP (Phase 1-2)
- EPIC-001: Install Pipeline (4 stories)
- EPIC-002: Ink TUI (4 stories)
- EPIC-003: Store Wizard (4 stories)
- EPIC-004: Uninstall Symmetry (3 stories)
- **Total**: 15 stories, all MUST features

### Quality Metrics
| Metric | Target | NFR |
|--------|--------|------|
| Initial render | <100ms | NFR-PERF-001 |
| Frame rate | 60 FPS | NFR-PERF-001 |
| Test coverage | ≥80% | NFR-TEST-001 |
| SUS score | ≥70 | NFR-UX-001 |

### Key Decisions (Locked)
1. **ink@^4.0.0** - ESM-first, React 18 patterns
2. **7 discrete stages** - Each idempotent, testable
3. **Summary card ≤15 lines** - Cognitive load constraint
4. **Error recovery-first** - Actionable guidance over diagnosis

### Non-Goals
- Backward compatibility (zero users)
- Alias commands (fabric join/setup)
- Non-CLI GUI (Web/Electron)

### Risks
| Risk | Severity | Mitigation |
|------|----------|------------|
| ink bundle size (~500KB) | Medium | Acceptable for CLI |
| React unfamiliarity | Low | ink API simpler |
| Terminal compatibility | Low | ink handles most |

### Next Steps
1. `/maestro-roadmap --from blueprint:BLP-fabric-install-ux-ink-tui-2026-06-06` - Generate execution roadmap
2. `/maestro-plan` - Plan first phase implementation
3. `/maestro-analyze` - Deep analysis of architecture

---

## Document Package

| Category | Files | Purpose |
|----------|-------|---------|
| Product Brief | 2 | Vision, goals, personas, glossary |
| Requirements | 12 | PRD with 8 REQ + 3 NFR |
| Architecture | 10 | 5 ADR + state machine + config + errors |
| Epics | 9 | 8 EPIC with 25 stories |
| Quality | 2 | Readiness report + summary |

**Total**: 34 files, 176.5 KB, Score: 91/100 ✅ PASS