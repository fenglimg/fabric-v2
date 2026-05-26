# rc.36 测评 PLAN(本轮 actual,事后回填)

## Boundary
- 类型:audit-only,不在 pcf 创新 branch,scratchpad 输出
- 工具:pcf packages/cli/dist (`2.0.0-rc.35`) → `npm link` → 全局 `fabric`
- 被测:~/Desktop/projects/werewolf-minigame/.fabric/ (8 天 19726 events)
- HEAD pre: `1aa16ac40a2b4bc2958bdcb0a705cd3bee21ce93`

## Cell 覆盖矩阵

| Cell | (A, B, C) | Batch | 状态 |
|---|---|---|---|
| events 心跳占比验证 | A2 × B2 × C3 | 1 deterministic | done — 95.1% |
| doctor 全 35 check 运行 | A2 × B1↔B2 × C1 | 1 deterministic | done — 8 warn |
| cite-coverage 真值 | A2 × B1↔B2 × C2+C3 | 1 deterministic | done — 10/17335 hallucination |
| KB activation funnel | A2 × B2 × C3 | 1 deterministic | done — 374→7→1 unchanged |
| SKILL token 在 production | A1 × B1↔B2 × C1 | 1 deterministic | done — W1 二轮成功 |
| Hook 升级机制断层 | A1+A2 × B1↔B2 × C1 | 1 deterministic | done — P0-NEW1 |
| AGENTS.md mental model | A1 × B3 × C1 | 3 simulated | done — 6 friction |
| 跨 LLM SKILL description recall | A1 × B1↔B2 × C1 | **2 skipped** | rc.34 12/12 PASS 复用 |
| Codex CLI baseline | A2 × B2 × C1 | **2 skipped** | rc.36 implementation precondition |
| Counterfactual ROI A/B | A3 × B3 × C3 | out-of-scope | 真人 dogfood 周期 |

## 输出结构 (actual)
```
.workflow/.scratchpad/rc36-werewolf-eval/
├── PLAN.md (本文件)
├── EVAL-REPORT.md (8 P0 + 4 P1 + 3 P2 + sizing)
├── scripts/
│   ├── snapshot.sh
│   └── restore.sh
└── evidence/
    ├── doctor-output.txt
    ├── events-histogram.txt
    ├── events-size.txt
    ├── cite-coverage.txt
    ├── cite-hallucinations.txt
    ├── installed-skills-size.txt
    ├── installed-skill-descriptions.txt
    ├── p1-2-stale-message-bug.txt
    ├── werewolf-fabric-pre.tar.gz (727 KB snapshot)
    ├── werewolf-filelist-pre.txt (8.5 KB filelist)
    ├── werewolf-head.txt
    ├── home-fabric-pre.tar.gz
    └── ... (其他 forensic 文件)
```

## Anti-pattern 防护实施情况
- [x] snapshot 在跑命令前完成
- [x] 跑 doctor / cite-coverage 不写入 pending(用 `doctor` 不用 `doctor --fix`)
- [ ] restore 待跑(在 rc.36 plan 锁定后)
- [ ] global cli 还原 rc.34 (待跑)
