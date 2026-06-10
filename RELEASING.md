# Releasing Fabric

This document defines the manual release path for Fabric. The workflow is intentionally explicit: every public release must pass the same ordered checks before a tag is pushed and before npm publication is treated as complete.

## Release Checklist

1. **Version audit / 版本检查**
   Confirm the root `package.json` version is the intended release version and matches all publishable workspace packages.

   ```bash
   node scripts/sync-versions.mjs
   ```

2. **Changelog review / CHANGELOG 更新**
   Update `CHANGELOG.md` so the release notes reflect the exact user-visible changes, release scope, and risk notes for the tag you are about to cut.

3. **Version sync validation / sync-versions 验证**
   Re-run the dedicated validator after any final version edit and stop immediately if any workspace package diverges from the root version.

   ```bash
   node scripts/sync-versions.mjs
   ```

4. **CI green / CI 通过**
   Make sure the `ci.yml` workflow is green for the target commit and that local validation still passes.

   ```bash
   pnpm install
   pnpm -r exec tsc --noEmit
   pnpm -r --if-present test
   node --experimental-strip-types scripts/lint-protected-tokens.ts
   NO_COLOR=1 pnpm --filter @fenglimg/fabric-cli test
   ```

5. **Create release tag / tag 创建**
   Create and push an annotated tag in the `v<version>` format from the exact commit you want to release. The tag push is the trigger for `.github/workflows/release.yml`; no manual publish dispatch is required.

   ```bash
   VERSION=1.5.2
   git tag -a "v${VERSION}" -m "Fabric v${VERSION}"
   git push origin "v${VERSION}"
   ```

6. **Wait for publish workflow / release.yml 触发**
   Confirm the tag push starts `.github/workflows/release.yml` automatically and that the workflow reaches the publish step with the expected `NODE_AUTH_TOKEN` secret configured.

7. **Confirm npm publication / npm publish 确认**
   Verify the release packages are visible on npm and resolve to the tagged version.

   ```bash
   npm view @fenglimg/fabric-cli version
   npm view @fenglimg/fabric-server version
   npm view @fenglimg/fabric-shared version
   ```

8. **Run post-publish validation / 发布后验证**
   Validate the published artifacts against the current onboarding path in `docs/USER-QUICKSTART.md` and `docs/RUNTIME-CONTRACTS.md`: install the published CLI, run `fabric install`, bind/select a mounted store, run `fabric doctor`, verify the stdio MCP tools, and archive/review one test knowledge entry when applicable.

9. **Create GitHub Release / GitHub Release**
   Create a GitHub Release for the new tag, using the matching `CHANGELOG.md` notes and any known caveats from the smoke run.

10. **Announce release / 公告**
    Publish the release announcement in the team channel, include install instructions, highlight the smoke result, and link the changelog plus onboarding documentation.

## Rollback Notes

- If npm publication partially succeeds, document exactly which packages published before retrying.
- If the smoke test fails after publish, create a follow-up patch release instead of silently editing documentation around the regression.
- Never move or delete an already-pushed release tag to hide a broken public artifact.
