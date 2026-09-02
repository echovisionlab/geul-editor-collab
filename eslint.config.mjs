import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const functionNodeTypes = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
]);

const noNestedIfRule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow nested if statements within the same function",
    },
    messages: {
      nested: "Replace nested if statements with a guard clause or helper.",
    },
    schema: [],
  },
  create(context) {
    return {
      IfStatement(node) {
        let current = node;
        let parent = node.parent;
        while (parent) {
          if (functionNodeTypes.has(parent.type)) {
            return;
          }
          if (parent.type === "IfStatement") {
            if (
              parent.alternate === current &&
              current.type === "IfStatement"
            ) {
              current = parent;
              parent = parent.parent;
              continue;
            }
            context.report({ node, messageId: "nested" });
            return;
          }
          current = parent;
          parent = parent.parent;
        }
      },
    };
  },
};

const noRelativeJavaScriptSpecifierRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow relative .js module specifiers in TypeScript source",
    },
    messages: {
      relativeJavaScript:
        "Use the TypeScript source extension; TypeScript rewrites it to .js when emitting.",
    },
    schema: [],
  },
  create(context) {
    const report = (node) => {
      if (
        typeof node?.value === "string" &&
        /^(?:\.{1,2}\/).*\.js$/.test(node.value)
      ) {
        context.report({ node, messageId: "relativeJavaScript" });
      }
    };

    return {
      ImportDeclaration: (node) => report(node.source),
      ExportNamedDeclaration: (node) => report(node.source),
      ExportAllDeclaration: (node) => report(node.source),
      ImportExpression: (node) => report(node.source),
      TSImportType: (node) => report(node.argument?.literal),
      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "vi" &&
          node.callee.property.type === "Identifier" &&
          ["mock", "unmock", "doMock"].includes(node.callee.property.name)
        ) {
          report(node.arguments[0]);
        }
      },
    };
  },
};

export default defineConfig(
  tseslint.configs.recommended,
  { ignores: ["**/*.{mjs,cjs,js,d.ts,d.mts}", "dist"] },
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: process.cwd(),
        project: ["./tsconfig.json"],
      },
    },
    plugins: {
      local: {
        rules: {
          "no-nested-if": noNestedIfRule,
          "no-relative-javascript-specifier": noRelativeJavaScriptSpecifierRule,
        },
      },
    },
  },
  {
    files: [
      "*.ts",
      "events/**/*.ts",
      "handlers/**/*.ts",
      "lib/**/*.ts",
      "scripts/**/*.ts",
      "workers/**/*.ts",
    ],
    rules: { "local/no-relative-javascript-specifier": "error" },
  },
  {
    files: [
      "index.ts",
      "env.ts",
      "events/**/*.ts",
      "handlers/**/*.ts",
      "lib/**/*.ts",
      "scripts/**/*.ts",
      "workers/**/*.ts",
    ],
    rules: {
      "local/no-nested-if": "error",
    },
  },
  {
    files: [
      "index.ts",
      "env.ts",
      "events/**/*.ts",
      "handlers/**/*.ts",
      "lib/**/*.ts",
      "workers/**/*.ts",
    ],
    ignores: ["**/*.test.ts"],
    rules: {
      complexity: ["error", 10],
      "max-lines": [
        "error",
        { max: 500, skipBlankLines: true, skipComments: true },
      ],
      "max-lines-per-function": [
        "error",
        { max: 100, skipBlankLines: true, skipComments: true },
      ],
      "max-depth": ["error", 3],
      "no-nested-ternary": "error",
      "no-else-return": "error",
      "no-lonely-if": "error",
      "no-unneeded-ternary": "error",
      "no-useless-constructor": "error",
    },
  },
);
