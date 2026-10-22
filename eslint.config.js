import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import { builtinModules } from "node:module";
import tseslint from "typescript-eslint";

// The layer import table from CODING_STANDARDS.md: which layers each layer may import.
const LAYERS = {
  core: [],
  storage: ["core"],
  ui: ["core", "storage"],
  server: [],
};

// The src/ layers; server/ sits at the top level and gets its own rule below.
const LAYER_NAMES = Object.keys(LAYERS).filter((layer) => layer !== "server");

function layerBoundaryRule(layer) {
  const forbidden = LAYER_NAMES.filter(
    (other) => other !== layer && !LAYERS[layer].includes(other),
  );
  const patterns = [
    {
      regex: String.raw`^(\.\./)+(${LAYER_NAMES.join("|")})/(?!index$).+`,
      message:
        "Import another layer only through its public entry, src/<layer>/index.ts.",
    },
  ];
  if (forbidden.length > 0) {
    patterns.push({
      regex: String.raw`^(\.\./)+(${forbidden.join("|")})(/|$)`,
      message: `The ${layer} layer may import only: ${LAYERS[layer].join(", ") || "nothing"}.`,
    });
  }
  if (layer !== "ui") {
    patterns.push({
      regex: "^react(-dom)?(/|$)",
      message: "Only the ui layer imports React.",
    });
  }
  patterns.push({
    regex: String.raw`^(\.\./)+server(/|$)`,
    message: "src/ never imports server/.",
  });
  return ["error", { patterns }];
}

// server/ runs without npm runtime dependencies: only `node:` built-ins and its own files. Tests may
// also import Vitest.
function serverImportRule({ allowVitest }) {
  const allowed = [
    String.raw`\.{1,2}/`,
    "node:",
    ...(allowVitest ? ["vitest$"] : []),
  ];
  return [
    "error",
    {
      paths: builtinModules
        .filter((name) => !name.startsWith("node:") && !name.startsWith("_"))
        .map((name) => ({
          name,
          message: `Import the built-in with its prefix: node:${name}.`,
        })),
      patterns: [
        {
          regex: String.raw`^(\.\./)+src(/|$)`,
          message: "server/ imports nothing from src/.",
        },
        {
          regex: `^(?!${allowed.join("|")})`,
          message: "server/ imports only node: built-ins and its own files.",
        },
      ],
    },
  ];
}

const DEFAULT_EXPORT_SYNTAX = [
  {
    selector: "ExportDefaultDeclaration",
    message: "Use named exports only.",
  },
  {
    selector: "ExportSpecifier[exported.name='default']",
    message: "Use named exports only.",
  },
];

const OTHER_RESTRICTED_SYNTAX = [
  {
    selector: "TSEnumDeclaration",
    message: "Use a string-literal union instead of an enum.",
  },
  {
    selector:
      ":matches(Program, Program > ExportNamedDeclaration) > VariableDeclaration > VariableDeclarator > :matches(ArrowFunctionExpression, FunctionExpression)",
    message: "Use a function declaration at module level.",
  },
];

export default defineConfig(
  globalIgnores(["dist", "dev-dist", "playwright-report", "test-results"]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "never" },
      ],
      // Destructuring a field away is how immutable state drops an optional property.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { ignoreRestSiblings: true },
      ],
      "no-restricted-syntax": [
        "error",
        ...DEFAULT_EXPORT_SYNTAX,
        ...OTHER_RESTRICTED_SYNTAX,
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  LAYER_NAMES.map((layer) => ({
    files: [`src/${layer}/**/*.{ts,tsx}`],
    rules: { "no-restricted-imports": layerBoundaryRule(layer) },
  })),
  {
    files: ["server/**/*.ts"],
    languageOptions: { globals: globals.node },
    rules: {
      "no-restricted-imports": serverImportRule({ allowVitest: false }),
    },
  },
  {
    files: ["server/**/*.test.ts"],
    rules: {
      "no-restricted-imports": serverImportRule({ allowVitest: true }),
    },
  },
  {
    // Time reaches the core only through events; timers already fail the pure typecheck.
    files: ["src/core/**/*.ts"],
    ignores: ["src/core/**/*.test.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "Date", message: "The core never reads a clock." },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "The core has no randomness.",
        },
      ],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "e2e/**/*.ts", "contract/**/*.ts"],
    rules: { "@typescript-eslint/consistent-type-assertions": "off" },
  },
  {
    // These tools require a default export.
    files: ["vite.config.ts", "playwright.config.ts", "eslint.config.js"],
    rules: { "no-restricted-syntax": ["error", ...OTHER_RESTRICTED_SYNTAX] },
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
