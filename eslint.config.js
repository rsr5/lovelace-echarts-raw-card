import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import lit from "eslint-plugin-lit";

export default tseslint.config(
  // Global ignores
  {
    ignores: ["dist/", "node_modules/", "dev/", "docs/"],
  },

  // Base JS recommended rules
  eslint.configs.recommended,

  // TypeScript recommended rules (type-aware)
  ...tseslint.configs.recommended,

  // Lit plugin recommended rules
  lit.configs["flat/recommended"],

  // Prettier turns off conflicting formatting rules (must be last)
  eslintConfigPrettier,

  // Project-specific overrides
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js", "vite.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Allow unused vars when prefixed with _
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Explicit any is sometimes unavoidable with HA types
      "@typescript-eslint/no-explicit-any": "warn",

      // Floating promises should be handled
      "@typescript-eslint/no-floating-promises": "error",

      // Prefer nullish coalescing
      "@typescript-eslint/prefer-nullish-coalescing": "off",

      // Console usage is intentional in this project (debug, info, warn, error)
      "no-console": "off",
    },
  },
);
