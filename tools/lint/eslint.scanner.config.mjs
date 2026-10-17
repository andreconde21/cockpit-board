// The directory scorecard lints with the plugin's tsconfig but without
// @types/node installed, so any Node type (`typeof import("fs")`, NodeJS.*)
// comes out as an error type and trips the no-unsafe-* rules. Lint once more
// the same way (types: []); declare the Node surface in src/node.ts instead.
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
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-return": "error",
    },
  },
]);
