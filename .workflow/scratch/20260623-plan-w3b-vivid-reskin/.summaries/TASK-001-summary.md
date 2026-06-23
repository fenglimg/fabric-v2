# TASK-001 — 结构基元两层切分
- 新建 `tui/structure.ts`(CLI-only): tree(├─└/+-`-)+ grid(对齐列 + ─/- 规则线),isColorEnabled 门控 ASCII fallback,paint.muted 画线(from ../colors.js)。
- theme.ts 加 sectionBar(▌/# )+ scopeBadge(team→drift/project→ai/personal→human)。
- theme.cjs 字节镜像同两函数 + module.exports;theme-parity.test.ts 扩 sectionBar/scopeBadge 全分支断言。
- 新 structure.test.ts:NO_COLOR ASCII fallback + FORCE_COLOR glyph。
- 验证:tsc 0;theme-parity+structure 绿(1123 tests);PALETTE 7 色取值 git-diff 0 变更;shared build 0。
