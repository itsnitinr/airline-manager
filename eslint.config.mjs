import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import nextConfig from "eslint-config-next/core-web-vitals";
import globals from "globals";
import tseslint from "typescript-eslint";

const domainBoundaryMessage =
  "Domain code must remain framework- and adapter-independent; depend only on domain-safe libraries.";

export default defineConfig(
  globalIgnores([
    "**/.next/**",
    "**/coverage/**",
    "**/dist/**",
    "**/node_modules/**",
    "**/*.tsbuildinfo",
  ]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...nextConfig,
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    settings: {
      next: {
        rootDir: "apps/web/",
      },
      react: {
        version: "19.2",
      },
    },
  },
  {
    files: ["packages/domain/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "next", message: domainBoundaryMessage },
            { name: "fastify", message: domainBoundaryMessage },
            { name: "bullmq", message: domainBoundaryMessage },
            { name: "@airline-manager/web", message: domainBoundaryMessage },
            { name: "@airline-manager/api", message: domainBoundaryMessage },
            { name: "@airline-manager/worker", message: domainBoundaryMessage },
            {
              name: "@airline-manager/database",
              message: domainBoundaryMessage,
            },
          ],
          patterns: [
            {
              group: [
                "next/*",
                "fastify/*",
                "bullmq/*",
                "@airline-manager/web/*",
                "@airline-manager/api/*",
                "@airline-manager/worker/*",
                "@airline-manager/database/*",
                "**/apps/*",
                "**/apps/**",
              ],
              message: domainBoundaryMessage,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/application/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "fastify", message: domainBoundaryMessage },
            { name: "bullmq", message: domainBoundaryMessage },
            { name: "@airline-manager/api", message: domainBoundaryMessage },
            { name: "@airline-manager/worker", message: domainBoundaryMessage },
          ],
          patterns: [
            {
              group: [
                "fastify/*",
                "bullmq/*",
                "@airline-manager/api/*",
                "@airline-manager/worker/*",
              ],
              message: domainBoundaryMessage,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@airline-manager/database",
              message:
                "The web application must access persistence through API contracts, not database adapters.",
            },
          ],
          patterns: [
            {
              group: ["@airline-manager/database/*"],
              message:
                "The web application must access persistence through API contracts, not database adapters.",
            },
          ],
        },
      ],
    },
  },
);
