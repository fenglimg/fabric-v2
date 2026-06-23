# TASK-002 — 删死依赖 picocolors
- package.json 删 `"picocolors": "^1.1.1"`;colors.ts 注释去 picocolors 字样。
- pnpm install 刷 lockfile;grep picocolors = 0(package.json + src);knip --strict 0;tsc 0。
