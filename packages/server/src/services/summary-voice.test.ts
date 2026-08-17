import { describe, expect, it } from "vitest";
import { assessSummaryVoice } from "./summary-voice.js";

/**
 * Calibration regression (KT-GLD-0022): these six cases are lifted VERBATIM from
 * the wespy-team-cocos-knowledge-base corpus that the pattern was narrowed
 * against. The three PASS cases are the naive pattern's false positives — all
 * correctly written declarative summaries that happened to contain the domain
 * noun `用户X`. If a future widening of VOICE_PATTERNS re-flags them, the gate
 * has regressed to its pre-calibration width.
 */
describe("assessSummaryVoice — calibration corpus", () => {
  const FALSE_POSITIVE_CORPUS: ReadonlyArray<readonly [string, string]> = [
    [
      "KT-PIT-0008 用户信息",
      "用户信息弹窗：renderUser 写入的 total/win_rate 会与 refreshSimpleGameStat 按玩法拉取的数据冲突，使局数与胜率被主页战绩错误覆盖。",
    ],
    [
      "KT-PIT-0007 用户信息",
      "卧底房：公屏非座位发言者资料缺失需要单独取用户信息；退房后聊天状态残留会污染下一局，必须在房间退出链路里显式清理聊天 store。",
    ],
    [
      "KT-GLD-0020 用户头像",
      "Cocos 用户头像显示:头像可能是 gif 动图,须用 ImageComponent(框架已预制头像 prefab 含 gif+蒙版,拖入即用)。",
    ],
  ];

  it.each(FALSE_POSITIVE_CORPUS)(
    "passes domain-noun summary: %s",
    (_label, summary) => {
      expect(assessSummaryVoice(summary)).toEqual({ ok: true });
    },
  );

  const SESSION_VOICE_CORPUS: ReadonlyArray<readonly [string, string]> = [
    [
      "vest-ui-diff-code-over-prefab",
      "我先直接改了 FriendPlayingListItem.prefab 的 _opacity，用户否掉：「具体实现方式是否增加额外代码合理一点」。此后每次提新的颜色差异都重申「同样只在代码里面改吧」。",
    ],
    [
      "KT-DEC-0015 exit-modal",
      "用户核对狼人/卧底游戏中退房弹窗是否被新退出挽留弹窗误覆盖,拍板:非游戏中用新弹窗,游戏中保留 main 分支原确认弹窗;并逐字确认实现方案。",
    ],
    [
      "png-compress-lossless-first",
      "用户要求为控分包体积压缩本次新增的贴图，前提是「不影响具体效果」，并点名可以用 imgkit。",
    ],
  ];

  it.each(SESSION_VOICE_CORPUS)("flags session-voice summary: %s", (_label, summary) => {
    const result = assessSummaryVoice(summary);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("summary_session_voice");
      expect(result.detail.length).toBeGreaterThan(0);
    }
  });
});

describe("assessSummaryVoice — shape", () => {
  it("passes an empty summary (other lints own that failure)", () => {
    expect(assessSummaryVoice("")).toEqual({ ok: true });
    expect(assessSummaryVoice("   ")).toEqual({ ok: true });
  });

  it("passes a well-formed declarative conclusion", () => {
    expect(
      assessSummaryVoice(
        "马甲包与主干的 UI 差异写进代码常量而非改 prefab：prefab 是索引寻址的 JSON，一旦分叉每次同步 main 都产生难解冲突。",
      ),
    ).toEqual({ ok: true });
  });

  it("flags English session voice by phrase, not by the bare noun `user`", () => {
    expect(assessSummaryVoice("User avatars may be animated gifs; use ImageComponent.")).toEqual({
      ok: true,
    });
    const flagged = assessSummaryVoice(
      "The user asked to compress the new textures, then rejected the palette path.",
    );
    expect(flagged.ok).toBe(false);
  });

  it("flags first-person wrong-turn narration", () => {
    expect(assessSummaryVoice("I first tried setting node opacity, which cascaded.").ok).toBe(false);
  });

  it("reports which marker families matched", () => {
    const result = assessSummaryVoice("用户要求本次改动必须拍板后再落地。");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toContain("用户");
      expect(result.detail).toContain("会话时点指代");
    }
  });
});
