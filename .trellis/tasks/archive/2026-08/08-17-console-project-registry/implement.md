# 项目注册表 — 执行计划

## 前置

```bash
pnpm install
pnpm --filter @fenglimg/fabric-cli build
```

> 全局 `fabric` 是 2.5.0-rc.4，落后本仓。全程用 workspace dist / vitest 验证，**不要**用 PATH 里的 `fabric` 判断改动是否生效。

## 步骤

### S1 核实前提（先量，别直接动手）
- [ ] 读 `packages/shared/src/resolver/project-context-resolver.ts:54` 的 `resolveProjectRoot`，确认它确实以 `.git` 为向上锚点、且签名可在 CLI 侧直接复用。
- [ ] 读 `packages/shared/src/node/atomic-write.ts:48` 的 `atomicWriteJson` 签名与失败行为。
- [ ] 读 `packages/cli/src/store/global-config-io.ts` 的 `resolveGlobalRoot`，确认 `FABRIC_HOME` 的尊重方式。
- [ ] 确认 `ValidateStage` 的 `planOnly` 早退分支覆盖所有 dry-run 入口（design C2 依赖这个前提）。

> 若任一前提不成立，**停下来改设计**，不要在实现里绕过。

### S2 注册表读写模块（TDD）
- [ ] 先写 `packages/cli/__tests__/project-registry-io.test.ts`：快照覆盖、损坏 JSON 自愈、缺失文件返回空、stale 派生、`FABRIC_HOME` 重定向生效（用明显非默认值）。
- [ ] 跑测试确认**红**——确认它测的是真东西，不是撞上默认值的假绿。
- [ ] 实现 `packages/cli/src/store/project-registry-io.ts`。
- [ ] 跑绿。

验证：
```bash
pnpm --filter @fenglimg/fabric-cli exec vitest run project-registry-io
```

### S3 接进 ValidateStage
- [ ] 在 `validate.stage.ts` 中，紧邻 `writeInstallManifest` 调用处接入 `registerProject`。
- [ ] 失败不抛（C6）；如需体现走 `StageResult.detail`，**不得**新增 `console.log`（KT-DEC-0044）。
- [ ] 补 install 层用例：连跑三次幂等、dry-run 不写（断言 mtime）、子目录执行登记仓库根。

验证：
```bash
pnpm --filter @fenglimg/fabric-cli exec vitest run install
```

### S4 CLI 出口
- [ ] 在 `fabric info` 下挂子命令列出注册表，带 `--json`。
- [ ] 人类视图与 `--json` 分别有用例；`--json` 的键保持稳定英文（不随语言变化）。

### S5 全量闸
- [ ] `pnpm --filter @fenglimg/fabric-cli exec vitest run`
- [ ] `pnpm -r exec tsc --noEmit` — 本地 `tsup --dts` 通过不等于 CI 的 `tsc --noEmit` 通过，这条历史上复发过三次，必须单独跑。
- [ ] `pnpm lint`
- [ ] 若改动触及 shared 的导出，先 `pnpm --filter @fenglimg/fabric-shared build` 再跑跨包 typecheck——跨包 typecheck 读的是依赖的 `dist/*.d.ts`，dist 陈旧会造成本地假红。

### S6 真机验证（dogfood）
- [ ] 用 workspace dist 在一个临时仓库跑一次 install，确认 `~/.fabric/state/projects.json` 生成正确。
- [ ] **注意**：不要用本机真实 `~/.fabric` 做破坏性试验；用 `FABRIC_HOME` 指到临时目录。

## 回滚点

- S2 结束：纯新增模块，无接线，删文件即回滚。
- S3 结束：install 行为已改变。回滚 = 撤销 validate.stage.ts 的改动；注册表文件本身是新增的，留着无害。
- 每个步骤收口即 commit（先开 feature 分支），不要攒到最后一次性提交。

## 完成判据

`prd.md` 的 AC1–AC8 全部勾掉，且 S5 四道闸全绿。
