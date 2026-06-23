# W3-B 视觉语言 — 4 命令 before → after mockup

色彩说明:`▌`段落头=accent(紫) · `[ok]`=success(绿) · `[warn]`=amber · `[err]`=error(红) · `[team]`=drift(紫) `[project]`=ai(蓝) `[personal]`=human(青) · 画线/计数=muted(灰)。none 档:`▌`→`#`、`├─`→`+-`、badge 纯文本。

## 1) fabric doctor
**BEFORE**(扁平彩色行)
```
✓ fabric doctor /repo
store health
  ✓ team store: 132 entries
  ✓ personal store: 8 entries
✓ TL;DR: all 48 checks green — nothing to fix.
```
**AFTER**(段落头 + tree + grid + badge)
```
▌ fabric doctor · /repo                                 [ok]

▌ Store Health
  ├─ [team]      team-knowledge   132 entries           [ok]
  └─ [personal]  personal           8 entries           [ok]

▌ Checks
  └─ 48 / 48 green — nothing to fix                      ✓
```

## 2) fabric install
**BEFORE**(W3-A ConsoleOutputRenderer,逐行)
```
Install Pipeline
running 7 stages
✓ (1/7) Preflight
✓ (2/7) Store
...
Install Complete
✓ 7 succeeded
All steps completed successfully
```
**AFTER**(tree 阶段 + grid summary)
```
▌ fabric install · /repo

  ├─ [ok] Preflight      (1/7)
  ├─ [ok] Environment    (2/7)
  ├─ [ok] Store          (3/7)
  ├─ [ok] Hooks          (4/7)
  ├─ [ok] MCP            (5/7)
  ├─ [ok] Validate       (6/7)
  └─ [ok] Guidance       (7/7)

▌ Summary
  ✓ 7 succeeded    ○ 0 skipped    × 0 failed
  All steps completed successfully
```

## 3) HUD / SessionStart(知识注入)
**BEFORE**(扁平缩进列表)
```
ALWAYS-ACTIVE RULES (无条件适用):
  [model] team:KT-MOD-0001 · scope 是三个互相独立的维度…
  [guideline] team:KT-GLD-0001 · 改源码前先读 bootstrap…
REFERENCE (情境触发):
  [decision] team:KT-DEC-0036 — SessionStart index-only…
```
**AFTER**(标题计数 + 作用域 badge 上色 + tree)
```
▌ Fabric Knowledge · 2 active · 38 reference

  ALWAYS-ACTIVE
  ├─ [team] model      KT-MOD-0001  scope 三维度独立…
  └─ [team] guideline  KT-GLD-0001  改源码前先读 bootstrap…

  REFERENCE  · Read when must_read_if fires
  ├─ [team] decision   KT-DEC-0036  SessionStart index-only…
  └─ [team] pitfall    KT-PIT-0007  co-location 删除是读侧迁移…
```
> 注:HUD 走 .cjs hook + theme-parity 字节镜像,结构基元须同步进 lib/theme.cjs 并保 parity(C-003 HUD-shared 层)。

## 4) error
**BEFORE**(renderError 多行)
```
✗ Error
something failed
💡 try running with --debug
```
**AFTER**(badge 标题 + 左竖条分组块)
```
▌ [err] InstallError

  │ Store clone failed: remote unreachable
  │
  │ 💡 check the URL or run with --debug
  │ ↳ ECONNREFUSED 127.0.0.1:443
```
