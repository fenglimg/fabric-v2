# Terminology — install 平淡感 grill

| Term | Definition | Code Reference | Status |
|------|------------|----------------|--------|
| renderer 二分 (render fork) | pipeline 每个视觉元素 `if(renderer){富 TUI}else{裸 console.log}` 的双路径结构,是平淡感的结构根因 | `pipeline.ts:78-190` | locked |
| OutputRenderer | TUI 渲染抽象,含 renderSection/renderStep/renderSummaryCard/renderError;静态能力已具备但交互路径未调用 | `tui/types.ts`, `tui/ConsoleOutputRenderer.ts` | locked |
| shouldUseInstallRenderer | 决定是否启用 renderer 的门;现仅 `--yes\|\|--dry-run` 返 true,致真人交互装吃裸日志(方向装反) | `install-v2.ts:175` | locked(待重构) |
| 静态富化 (static richness) | 不依赖动画、不与 clack 提问冲突的视觉:图标/阶段徽章/summary 卡片/error box。本 grill 的核心修复方向 | `pipeline.ts` else 分支待补 | locked |
| 动画 spinner | 实时重绘进度,与阻塞式 clack 提问同 TTY 冲突,故仅应在无 pending prompt 时启用 | `renderStep status:running` | locked |
| scan payoff | env stage 已建 forensicReport 却零 surface 的"它懂我"时刻缺失 | `env.stage.ts:96/98` | locked |
| forensicReport | install 期对项目的取证扫描产物,写入 forensic.json,当前不向用户展示发现 | `scanner/forensic.ts buildForensicReport` | locked |
| 结果状态措辞 vs 裸计数 | `installed=0 skipped=135`(机器视角)应改"已最新 ✓"(人类视角),裸计数移 --debug | `hooks.stage.ts:119 formatStageResult` | locked |
| 体验通路 vs 内容正确性 | 本 grill 的双轴:本场查"felt experience/通路",2026-06-10 场查"内容正确性",正交不重叠 | — | locked |
| 单一首要动作 (single primary next-step) | 收尾应给一个锚点动作而非 3 条 next-steps + 4×6 能力表 | `guidance.stage.ts:162-235` | locked |
