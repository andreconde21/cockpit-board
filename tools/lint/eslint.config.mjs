// Same rules Obsidian's directory review runs (eslint-plugin-obsidianmd),
// pointed at the plugin source two levels up.
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: path.join(root, "tsconfig.json"),
        tsconfigRootDir: root,
      },
    },
  },
]);
