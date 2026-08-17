# B2 S4 — 零上下文冷评(带对照组)

判官:`maestro delegate --to codex --mode analysis`,只喂 summary、不喂正文,rubric 逐字取自
`packages/server/src/services/summary-cold-eval.ts` 的 `COLD_EVAL_RUBRIC` /
`COLD_EVAL_RUBRIC_REFERENCE`。作者(我)不参与判定 —— `KT-GLD-0006` 的实证是自评 100%、
冷评 81%,自评不作数。

原计划的 `--to agy` 走不通:`Eligibility check failed ... not currently available in
your location`,换 codex。

## 抽样

81 条改写过的 summary,按 type 分层各取前 5 条(路径序,非挑选),共 25 条:

| family | rubric | 条数 | PASS |
| --- | --- | --- | --- |
| rule(guidelines / models) | `COLD_EVAL_RUBRIC` | 10 | 10 |
| reference(decisions / pitfalls / processes) | `COLD_EVAL_RUBRIC_REFERENCE` | 15 | 15 |

## 对照组(这才是判据)

25/25 全过本身**不能**说明改写有效 —— 也可能只是判官松。所以补一轮盲测:
从治理前的基线提交 `428afdf` 取回 6 条**同一批文件的原始 summary** 作对照,
与 6 条改写后的交错混排、id 匿名成 `S1..S12`(判官看不出哪边是哪边),同一 rubric 跑一遍。

结果:

- 对照组(改写前)6 条 → **3 条判 FAIL**(`S1` / `S7` / `S11`,理由都是"复述会话过程、
  没给结论"),另 3 条虽是会话叙述但正文结论恰好落在了 summary 里,判 PASS。
- 处理组(改写后)6 条 → **6 条全 PASS**。

即这套 rubric 在这个判官上**确实有区分力**(不是橡皮图章),同时它偏松 —— 已知坏样本
只抓出一半。所以结论要按上界读:**改写后的 summary 在冷评下无一失败,但 25/25 是上界不是
证明**;真实通过率不会高于此。

## 遗留

- `pending/decisions/invite-click-closes-modal-no-10010` 仍被 `assessSummaryVoice` 判命中
  「用户」—— 是**真误报**:那句是「10010 的语义是用户拒绝」,领域名词而非会话人称。
  其冷评(`S10`)判 PASS。
- 另 5 条命中全在 `rejected/` 下,不浮现,不在射程内。

## 复现

```bash
node --experimental-strip-types .trellis/tasks/08-17-knowledge-narrative-and-retention/scripts/measure-voice.mjs --store /Users/wepie/.fabric/stores/team/wespy-team-cocos-knowledge-base
```
