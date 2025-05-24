
module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "google",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json"], // Simplified to just tsconfig.json
    sourceType: "module",
    tsconfigRootDir: __dirname, // Ensures correct path resolution for tsconfig.json
  },
  ignorePatterns: [
    "/lib/**/*", // Ignore built files.
    ".eslintrc.js", // Crucially, ignore this file itself from TS parsing
  ],
  plugins: ["@typescript-eslint", "import"],
  rules: {
    "quotes": ["error", "double"],
    "import/no-unresolved": 0,
    "indent": ["error", 2],
    "object-curly-spacing": ["error", "never"], // Google style typically uses 'always' or 'never'. Let's stick to never as per your output.
    "require-jsdoc": 0, // Disable JSDoc requirement
    "max-len": ["error", {"code": 120}], // Max line length
    "comma-dangle": ["error", "always-multiline"], // Require trailing commas for multiline
    "no-trailing-spaces": "error",
    "padded-blocks": ["error", "never"],
  },
};
