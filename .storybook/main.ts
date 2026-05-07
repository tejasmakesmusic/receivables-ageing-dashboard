// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- Storybook packages are declared in package.json and installed by the orchestrator.
import type { StorybookConfig } from "@storybook/nextjs";

const config: StorybookConfig = {
  framework: { name: "@storybook/nextjs", options: {} },
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: [
    "@storybook/addon-essentials",
    "@storybook/addon-a11y",
    "@storybook/addon-interactions",
  ],
  staticDirs: ["../public"],
};

export default config;
