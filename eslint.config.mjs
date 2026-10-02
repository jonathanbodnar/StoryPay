import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The Zapier app is plain CommonJS, which the Zapier CLI requires.
  {
    files: ["zapier-app/**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output and generated files elsewhere in the repo:
    "homepage/**", // the StoryPay.io website lints itself (homepage/eslint.config.mjs)
    "android/**",
    "ios/**",
    "capacitor-shell/**",
    "graphify-out/**",
    "playwright-report/**",
    "test-results/**",
    "public/sw.js",
  ]),
]);

export default eslintConfig;
