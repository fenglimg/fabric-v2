export const allCommands = {
  init: () => import("./init.js").then((module) => module.default),
  update: () => import("./update.js").then((module) => module.default),
  scan: () => import("./scan.js").then((module) => module.default),
  serve: () => import("./serve.js").then((module) => module.default),
  doctor: () => import("./doctor.js").then((module) => module.default),
  "sync-meta": () => import("./sync-meta.js").then((module) => module.default),
  "human-lint": () => import("./human-lint.js").then((module) => module.default),
  "ledger-append": () => import("./ledger-append.js").then((module) => module.default),
  "pre-commit": () => import("./pre-commit.js").then((module) => module.default),
  bootstrap: () => import("./bootstrap.js").then((module) => module.default),
  config: () => import("./config.js").then((module) => module.configCmd),
  hooks: () =>
    import("./hooks.js").then((module) => ({
      ...module.default,
      meta: {
        ...module.default.meta,
        hidden: true,
      },
    })),
};
