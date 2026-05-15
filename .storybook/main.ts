// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- Storybook packages are declared in package.json and installed by the orchestrator.
import type { StorybookConfig } from "@storybook/nextjs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const config: StorybookConfig = {
  framework: {
    name: "@storybook/nextjs",
    options: {
      builder: {
        fsCache: false,
      },
    },
  },
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: [
    "@storybook/addon-essentials",
    "@storybook/addon-a11y",
    "@storybook/addon-interactions",
  ],
  staticDirs: ["../public"],
  webpackFinal: async (config) => ({
    ...config,
    cache: false,
    resolve: {
      ...config.resolve,
      alias: {
        ...config.resolve?.alias,
        "next/config": require.resolve("../scripts/storybook-next-config-mock.cjs"),
      },
    },
  }),
};

export default config;
