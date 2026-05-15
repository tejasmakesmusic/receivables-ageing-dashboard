import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src/generated/prisma/**",
      "frontend/dist/**",
      "backend/dist/**",
      "storybook-static/**",
      ".storybook-home/**",
    ],
  },
  ...nextVitals,
  ...nextTypescript,
];

export default eslintConfig;
