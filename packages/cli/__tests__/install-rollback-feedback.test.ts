import { describe, expect, it } from "vitest";

import { t } from "../src/i18n.js";
import { InstallPipeline } from "../src/install/pipeline/pipeline.js";
import type {
  InstallContext,
  Stage,
  StageResult,
} from "../src/install/pipeline/types.js";
import type { ErrorInfo, OutputRenderer, StepInfo, SummaryInfo } from "../src/tui/types.js";

// 2.5.1 defect #3 — the rollback report contradicted the disk. With an EMPTY
// rollback stack the old copy still told the user the project was left
// unchanged, even though earlier stages had already scaffolded `.fabric/`
// (including a `{}` fabric-config.json that resolves worse than no file at all).
// The count is what the rollback stack KNOWS about; "unchanged" is a claim about
// the filesystem. These tests pin the two branches apart.

class CapturingRenderer implements OutputRenderer {
  readonly warnings: string[] = [];
  readonly infos: string[] = [];

  renderStep(_step: StepInfo): void {}
  renderSuccess(_message: string): void {}
  renderError(_error: ErrorInfo | Error): void {}
  renderWarning(message: string): void {
    this.warnings.push(message);
  }
  renderInfo(message: string): void {
    this.infos.push(message);
  }
  renderSummaryCard(_summary: SummaryInfo): void {}
  renderSection(_title: string): void {}
  renderComplete(): void {}
}

function failingStage(register?: (context: InstallContext) => void): Stage {
  return {
    name: "store",
    async execute(context: InstallContext): Promise<StageResult> {
      register?.(context);
      throw new Error("boom");
    },
  };
}

function makeContext(renderer: OutputRenderer): InstallContext {
  return {
    target: "/tmp/does-not-matter",
    args: {},
    options: {},
    mcpInstallMode: "local",
    claudeMcpScope: "project",
    mcpRootPolicy: { mode: "dynamic" },
    interactive: false,
    wizardEnabled: false,
    stageResults: [],
    rollbackStack: [],
    // firstInstall=true keeps the pipeline streaming live instead of buffering
    // through RecordingRenderer, so warnings land on our capture directly.
    state: { firstInstall: true },
    renderer,
  };
}

describe("install rollback feedback", () => {
  it("does not claim the project is unchanged when nothing was rolled back", async () => {
    const renderer = new CapturingRenderer();
    const result = await new InstallPipeline()
      .addStage(failingStage())
      .execute(makeContext(renderer));

    expect(result.success).toBe(false);
    expect(renderer.warnings).toContain(t("cli.install.rollback.feedback.none"));
    // The counted wording must not appear — a count of 0 is not a clean disk.
    expect(renderer.warnings).not.toContain(
      t("cli.install.rollback.feedback", { count: "0" }),
    );
  });

  it("reports the reverted count when the rollback stack actually ran", async () => {
    const renderer = new CapturingRenderer();
    const result = await new InstallPipeline()
      .addStage(
        failingStage((context) => {
          context.rollbackStack.push({ stage: "store", action: async () => {} });
          context.rollbackStack.push({ stage: "store", action: async () => {} });
        }),
      )
      .execute(makeContext(renderer));

    expect(result.success).toBe(false);
    expect(renderer.warnings).toContain(
      t("cli.install.rollback.feedback", { count: "2" }),
    );
    expect(renderer.warnings).not.toContain(t("cli.install.rollback.feedback.none"));
  });

  it("keeps the two messages distinct in every shipped locale", () => {
    expect(t("cli.install.rollback.feedback.none")).not.toBe(
      t("cli.install.rollback.feedback", { count: "0" }),
    );
    // A missing key falls through to the raw key string — guard against that.
    expect(t("cli.install.rollback.feedback.none")).not.toBe(
      "cli.install.rollback.feedback.none",
    );
  });
});
