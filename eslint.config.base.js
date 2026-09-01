import js from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    plugins: {
      boundaries,
    },
    settings: {
      "boundaries/elements": [
        { type: "shared", pattern: "**/src/shared/**" },
        { type: "domain", pattern: "**/src/domain/**" },
        { type: "application", pattern: "**/src/application/**" },
        { type: "adapters", pattern: "**/src/adapters/**" },
        { type: "cli", pattern: "**/src/cli/**" },
      ],
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            {
              from: "cli",
              allow: ["cli", "application", "adapters", "domain", "shared"],
            },
            {
              from: "application",
              allow: ["application", "domain", "shared"],
            },
            {
              from: "adapters",
              allow: ["adapters", "domain", "shared"],
            },
            {
              from: "domain",
              allow: ["domain", "shared"],
            },
            {
              from: "shared",
              allow: ["shared"],
            },
          ],
        },
      ],
      "boundaries/external": [
        "error",
        {
          default: "allow",
          rules: [{ from: ["domain", "shared"], disallow: ["*"] }],
        },
      ],
    },
  },
  {
    files: ["**/src/{domain,shared}/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*"],
              message:
                "domain/shared must stay pure; put Node APIs behind a domain port.",
            },
          ],
        },
      ],
    },
  },
);
