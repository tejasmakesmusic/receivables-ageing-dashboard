/* eslint-disable @typescript-eslint/no-require-imports */
const Module = require("module");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.CI = process.env.CI || "1";
process.env.STORYBOOK_DISABLE_TELEMETRY = "1";

os.homedir = () => path.join(process.cwd(), ".storybook-home");

const originalResolveFilename = Module._resolveFilename;
const originalLoad = Module._load;
const projectRoot = process.cwd();
const virtualBabelConfigPath = path.join(projectRoot, ".babelrc");

const storybookNextFs = new Proxy(fs, {
  get(target, prop) {
    if (prop === "existsSync") {
      return (targetPath) => {
        if (path.resolve(String(targetPath)) === virtualBabelConfigPath) {
          return true;
        }

        return target.existsSync(targetPath);
      };
    }

    return target[prop];
  },
});

Module._load = function load(request, parent, isMain) {
  if (request === "webpack-sources" || request.startsWith("next/dist/compiled/webpack-sources")) {
    return originalLoad.call(
      this,
      originalResolveFilename.call(this, "webpack-sources", parent, isMain),
      parent,
      isMain,
    );
  }

  if (
    request === "fs" &&
    typeof parent?.filename === "string" &&
    parent.filename.includes(`${path.sep}@storybook${path.sep}nextjs${path.sep}dist${path.sep}preset.js`)
  ) {
    return storybookNextFs;
  }

  return originalLoad.call(this, request, parent, isMain);
};

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (request === "next/config") {
    return originalResolveFilename.call(
      this,
      "next/dist/server/config.js",
      parent,
      isMain,
      options,
    );
  }

  if (
    request === "next/dist/compiled/webpack" ||
    request === "next/dist/compiled/webpack/webpack" ||
    request === "next/dist/compiled/webpack/bundle5" ||
    request.startsWith("next/dist/compiled/webpack/")
  ) {
    return originalResolveFilename.call(this, "webpack", parent, isMain, options);
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};
