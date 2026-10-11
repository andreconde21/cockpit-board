// The directory scorecard type-checks without the plugin's tsconfig, so
// TypeScript's defaults apply (ES5 target): a for-of or spread over a Map or
// Set comes out `any` and trips the no-unsafe-* rules. Lint once more the
// same way; wrap such iterables in Array.from().
import { defineConfig } from "eslint/config";
import path from "node:path";
import base from "./eslint.config.mjs";

export default defineConfig([
  ...base,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: path.join(import.meta.dirname, "tsconfig.scanner.json"),
        tsconfigRootDir: path.resolve(import.meta.dirname, "../.."),
      },
    },
    // Without strictNullChecks these two misfire (every `!` looks redundant);
    // the scorecard does not report them and the main pass covers them.
    rules: {
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-return": "error",
    },
  },
]);
