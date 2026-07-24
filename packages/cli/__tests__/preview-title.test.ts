import { describe, expect, it } from "vitest";

import { extractH1Title, firstSentence, toPreviewEntry } from "../src/commands/preview.js";
import type { StoreCanonicalEntry } from "@fenglimg/fabric-server";

// Title chain (census-verified, user-locked): frontmatter `title:` → body H1 →
// summary first sentence (40-char clamp) → stableId. Never an English slug.
describe("preview title chain", () => {
  function makeEntry(overrides: { body: string; summary?: string }): StoreCanonicalEntry {
    return {
      stableId: "KT-DEC-9999",
      qualifiedId: "fabric-team:KT-DEC-9999",
      layer: "team",
      type: "decisions",
      file: "/tmp/x.md",
      body: overrides.body,
      description: {
        summary: overrides.summary,
        semantic_scope: "team",
        maturity: "draft",
        created_at: undefined,
        tags: [],
      },
    } as unknown as StoreCanonicalEntry;
  }

  it("prefers frontmatter title over H1 and summary", () => {
    const entry = makeEntry({
      body: '---\ntitle: "精炼中文标题"\nsummary: "很长的归档叙事。"\n---\n\n# 另一个 H1 标题\n\n正文',
      summary: "很长的归档叙事。",
    });
    const preview = toPreviewEntry(entry);
    expect(preview.title).toBe("精炼中文标题");
    expect(preview.summary).toBe("很长的归档叙事。");
  });

  it("falls back to body H1 when no frontmatter title", () => {
    const entry = makeEntry({
      body: "---\nsummary: x\n---\n\n# Goal Y 不被 multistore 阻塞\n\n正文",
      summary: "很长的归档叙事,第一句。第二句。",
    });
    expect(toPreviewEntry(entry).title).toBe("Goal Y 不被 multistore 阻塞");
  });

  it("falls back to summary first sentence (40-char clamp) when neither title nor H1", () => {
    const entry = makeEntry({
      body: "---\nsummary: x\n---\n\n## Context\n\n正文无 H1",
      summary: "MobX 使用规范（Cocos Creator 2.x MobX 4/5 兼容版）：状态推导副作用单向流,这句超过四十个字符需要被截断处理。后面还有第二句。",
    });
    const title = toPreviewEntry(entry).title;
    expect(title.length).toBeLessThanOrEqual(41); // 40 + 省略号
    expect(title.endsWith("…") || title.length <= 40).toBe(true);
    expect(title.startsWith("MobX 使用规范")).toBe(true);
  });

  it("falls back to stableId when body and summary are both empty", () => {
    const entry = makeEntry({ body: "---\ntype: decisions\n---\n\n没有标题的正文", summary: undefined });
    expect(toPreviewEntry(entry).title).toBe("KT-DEC-9999");
  });

  it("extractH1Title ignores deeper headings", () => {
    expect(extractH1Title("## 二级标题\n\n# 一级标题")).toBe("一级标题");
    expect(extractH1Title("## 只有二级")).toBeUndefined();
  });

  it("firstSentence splits on Chinese and Latin sentence ends", () => {
    expect(firstSentence("短句。后续。")).toBe("短句。");
    expect(firstSentence("Short sentence. More text.")).toBe("Short sentence.");
    expect(firstSentence(undefined)).toBeUndefined();
    expect(firstSentence("  ")).toBeUndefined();
  });
});
