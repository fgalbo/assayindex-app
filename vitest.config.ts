import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/assayindex/**/*.test.ts"],
          exclude: [
            "tests/assayindex/cdc-source-offerings.test.ts",
            "tests/assayindex/storage.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          setupFiles: ["./tests/setup.tsx"],
          css: true,
          include: [
            "tests/assayindex/**/*.test.tsx",
            "tests/assayindex/cdc-source-offerings.test.ts",
            "tests/assayindex/storage.test.ts",
          ],
        },
      },
    ],
  },
});
