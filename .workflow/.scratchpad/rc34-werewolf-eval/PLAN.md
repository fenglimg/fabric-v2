# rc.34 Werewolf-Minigame 测评 PLAN

## Boundary
- **类型**: audit-only, no fix in same session
- **Branch 行为**: 不在 pcf 创新 branch, 输出落 scratchpad (rc.34 主线 ship 后再决 fix bundle)
- **被测**: ~/Desktop/projects/werewolf-minigame/.fabric/ (真实长跑 7.9MB events.jsonl)
- **工具**: pcf dev cli `node /Users/wepie/Desktop/personal-projects/pcf/packages/cli/dist/index.js` (v2.0.0-rc.34)

## Pre-snapshot baseline
- werewolf HEAD: `700dc09ab181ce0e7b36eb911043103c2b3a10ec` (release/act-0601-sweet-childhood)
- werewolf working tree: 4 个 pre-existing modified files (Setting.prefab/Setting.ts/Const.ts/SpyGameSoundUtil.ts) — NOT 测评关注对象, 不动
- werewolf `.fabric/` 文件数: 128
- `~/.fabric/`: 只有 knowledge/ 一个目录 + .DS_Store

## Cell 覆盖矩阵 (3 轴 meta framework)

| Cell | A 对象 | B 视角 | C 时间 | 范式 | Batch |
|---|---|---|---|---|---|
| D-doctor | tool/state | dev/auditor | C1 now | Deterministic | 1 |
| D-events | usage trace | system | C1+C3 (7.9MB 累积) | Deterministic | 1 |
| D-forensic | state file | system | C1 | Deterministic | 1 |
| D-cite | behavior | AI 自评 | C1 抽样 | Deterministic | 1 |
| D-hook | impl | dev | C1 | Deterministic | 1 |
| L-skill | description | new-AI | C1 | LLM-judge (3 家) | 2 |
| L-entry | knowledge body | AI consumer | C1 | LLM-judge (3 家) | 2 |
| L-archive | archive flow | AI proposer | C1 | LLM-judge | 2 |
| H-onboard | first 10 min | new-dev (sim) | C1 | Simulated human | 3 |
| H-discovery | KB discovery flow | new-AI on edit | C1 | Simulated human | 3 |
| H-archive-ux | archive prompt UX | end-user | C1 | Simulated human | 3 |
| H-doctor-ux | doctor remediation | dev fixing | C1 | Simulated human | 3 |

**Out-of-scope (本轮不做, 推 rc.35+)**:
- 真人新手 fresh install 录屏 (改用 simulated)
- KB cohort 长期衰减 (C3 真长期, 当前 7.9MB 已经是 snapshot)
- Cross-client (Codex/Cursor 体验) — 只测 Claude Code 视角

## 输出结构
```
.workflow/.scratchpad/rc34-werewolf-eval/
├── PLAN.md (本文件)
├── EVAL-REPORT.md (顶层汇总, ≤5 P0)
├── batches/
│   ├── T1-deterministic.md
│   ├── T2-llm-judge.md
│   └── T3-simulated-human.md
├── evidence/
│   ├── werewolf-fabric-pre.tar.gz   ✓
│   ├── home-fabric-pre.tar.gz       ✓
│   ├── werewolf-filelist-pre.txt    ✓ (128 files)
│   ├── doctor-output.txt
│   ├── events-analysis.json
│   └── llm-*-output.md
└── scripts/
    ├── snapshot.sh / restore.sh
    └── events-scan.py
```

## Anti-pattern 防护 checklist
- [x] snapshot 在跑命令前完成
- [ ] Batch 顺序: 0 → 1 → 2 → 3 → 汇总, 不跳序
- [ ] 跨 LLM ≥2 家 (gemini + codex + Claude inline)
- [ ] EVAL-REPORT.md TL;DR ≤ 5 P0
- [ ] 结束前 restore + forensic diff
