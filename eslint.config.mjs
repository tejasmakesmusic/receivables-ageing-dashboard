import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [".next/**", "node_modules/**", "src/generated/prisma/**", "frontend/dist/**", "backend/dist/**"],
  },
  ...nextVitals,
  ...nextTypescript,
];

export default eslintConfig;
