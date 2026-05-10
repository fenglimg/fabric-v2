export const allCommands = {
  init: () => import("./init.js").then((module) => module.default),
  scan: () => import("./scan.js").then((module) => module.default),
  serve: () => import("./serve.js").then((module) => module.default),
  doctor: () => import("./doctor.js").then((module) => module.default),
  hooks: () => import("./hooks.js").then((module) => module.default),
};
