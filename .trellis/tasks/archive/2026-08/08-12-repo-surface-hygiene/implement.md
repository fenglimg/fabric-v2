# Implement — 仓库门面整洁化

## 执行顺序总原则

**按「判别力从强到弱」排,不按「工作量从小到大」排。** 强判据的项先做,一旦某步把基线打破,
后面的项还能靠它抓到 —— 反过来先做弱判据项,基线一旦漂了就再也说不清是谁弄的。

每个批次独立 `git commit`(分批 commit 纪律);非交互提交用 `LEFTHOOK=0 git commit`。

---

## 步骤 0 · 建立基线(必做,不可跳)

后面所有「行为等价」断言都依赖这组数字。**先记录再动手。**

```bash
pnpm -r exec tsc --noEmit                      # 必须先绿,否则基线不可信
pnpm --filter @fenglimg/fabric-shared test 2>&1 | tail -3
pnpm --filter @fenglimg/fabric-server test 2>&1 | tail -3
pnpm --filter @fenglimg/fabric-cli    test 2>&1 | tail -3
node scripts/lint-dangling-refs.mjs
pnpm lint
```

**落盘**: 三包各自的 `passed / skipped` 数字写进 `research/baseline.md`。
A5 验收比的就是这组数,**不是「绿不绿」**。

> ⚠️ 已知环境噪声,不要当回归: 嵌套 worktree 存在时,主 checkout 的
> `hooks-runtime-generated` 会假红;`.claude/worktrees/` 里跑 hook 测试会有 21 个假失败。
> 记基线时若命中,在 `baseline.md` 里标注,不要试图"修"。

---

## 步骤 1 · R1 垃圾清理 + 忽略规则收窄 【判别力最强,先做】

1. `rm -rf 'packages/cli/C:'`
2. `.gitignore` 第 139 行 `tmp/` → `/tmp/`,并**更新那条规则的注释**说明为什么加前导斜杠
   (注释与规则同改 —— 只改规则会留下一条说着旧意图的注释,即 dual-truth)。
3. 跑构造式探针(design.md R1 那段两条断言全跑)。
4. 确认 `git status --porcelain -uall` 除本任务工件外无新增噪声。
5. **收口记录里显式写明遗留**: `C:` 由某个未正确处理 Windows 路径的测试写出,源头未修,
   本次只清症状 + 让复发可见。

**commit**: `fix(repo): 删 packages/cli/C: 垃圾 + tmp/ 忽略规则锚定到根目录`

---

## 步骤 2 · R2 `schemas/` 处置 【中等判别力】

1. **先查 dual-truth 关系**: `schemas/fabric-config.json` 与 `packages/shared` 里的
   zod config schema 是否描述同一个东西。
   - 若是 → 删它是**修复 dual-truth**,在 commit message 里这么写。
   - 若不是 → 退回来重新评估,不要硬删。
2. 引用普查范围**必须包含** `scripts/` `.github/workflows/` `package.json`。
   用 node `String.includes`,**不要用本机 Bash grep**(已知 ugrep 假阴性)。
3. 删除后跑 `knip` + `lint-dangling-refs` + 全套测试。

**`assets/` 不在本步执行** —— 需先向用户确认两个品牌 SVG 有无仓外用途(design.md R2)。
在本步末尾把这个问题提出来,不要替用户决定。

**commit**: `refactor(repo): 删无消费者的 schemas/fabric-config.json`(措辞按第 1 步结论调整)

---

## 步骤 3 · R4 `services/` 分组 【最大的一块,单独一批】

### 3a 推导分组(不写代码,只出结论)

1. 算 97 个源文件的静态 import 图(双向)。
2. 按 design.md 的两条门槛筛簇: **≥4 文件 且 簇内耦合明显高于簇间**。
3. 不达标的**留在顶层**,不硬凑目录。
4. 结论写进 `research/services-clusters.md`,含每个簇的成员与**落选文件的落选理由**。

> ⚠️ 这一步最容易犯的错是按文件名分组。`doctor-*` 有 48 个看起来天然成簇,
> **但要验证它们真的互相耦合**,而不只是共享一个前缀 —— 前缀是命名约定,不是依赖事实。

### 3b 迁移前置普查

在动任何文件前,把 `scripts/` + `.github/workflows/` + `package.json` 的 npm scripts
里对 `services/` 路径的硬编码引用全部找出来。**这是已有判例的复发点**:
改路径漏迁这三处 → 本地全绿 CI 红。

### 3c 执行迁移

- 一次只搬**一个簇**,每搬完一个跑一次 `tsc --noEmit` + server 全套测试。
- 用 `git mv`,不用 rm+add。
- **共址测试跟着它测的源文件一起搬。**
- `vitest.config.ts` 的 coverage `include`/`exclude` glob 若含路径,同步更新。

### 3d 验收

| 判据 | 阈值 |
|---|---|
| `ls packages/server/src/services` 顶层条目 | < 40(基线 179) |
| server 测试 passed 数 | **与 baseline.md 完全相等** |
| `tsc --noEmit` | 退出 0 |
| `knip` | 无新增未用项 |

**commit**: 每个簇一个 commit,message 写明「搬了哪些 / 为什么这几个是一簇」。

---

## 步骤 4 · R3 本机残留清理 【零仓库收益,放最后】

`rm -rf .cursor .antigravitycli .worktrees`(均为已忽略的本机产物,重跑 install 可复原)。
`tmp/`(535M) `local_cache/`(91M) **先问用户** —— `tmp/` 里是供设计对照阅读的同类项目克隆,
可能仍在用。

**不 commit**(全是已忽略路径,无 diff)。只在收口记录里写一句做了什么。

---

## 步骤 5 · R5 文档化 + R6 结论回填 【最弱,时间紧则砍 R5】

- `docs/TESTING.md` 增补三包布局差异与原因,并核 shared 那 9 个共址例外。
- 把 R6 的评估结论(`.trellis/` 102 文件是有意保留)写进收口记录。
- 回填 08-10 任务的 roadmap: **B10 翻案**,注明理由是价值函数变化(KT-GLD-0011),
  不是新证据。

**commit**: `docs: 三包测试布局差异说明 + B10 翻案回填`

---

## 收口 gate(全部步骤后)

```bash
pnpm -r exec tsc --noEmit          # 必跑,不能只靠 build(本地/CI 差异已复发三次)
pnpm --filter @fenglimg/fabric-shared test
pnpm --filter @fenglimg/fabric-server test
pnpm --filter @fenglimg/fabric-cli    test
node scripts/lint-dangling-refs.mjs
pnpm lint
```

对照 `research/baseline.md` **逐包比对用例数**,不是看绿。

## 回滚点

- 步骤 1/2/4 单个 commit `git revert` 即可。
- 步骤 3 每簇一个 commit,可逐簇回滚。**若某簇搬完测试数对不上,立刻回滚该簇再查,
  不要带着不一致继续搬下一簇。**
