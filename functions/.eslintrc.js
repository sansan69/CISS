
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
    project: ["tsconfig.json"], // Main tsconfig for src
    sourceType: "module",
    tsconfigRootDir: __dirname,
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
    "object-curly-spacing": ["error", "never"],
    "require-jsdoc": 0,
    "max-len": ["error", {"code": 160, "ignoreUrls": true, "ignoreStrings": true, "ignoreTemplateLiterals": true, "ignoreComments": true}], // Increased length
    "comma-dangle": ["error", "always-multiline"],
    "no-trailing-spaces": "error",
    "padded-blocks": ["error", "never"],
    "@typescript-eslint/no-explicit-any": "warn", // Changed from error to warn
    "new-cap": ["error", { "capIsNewExceptions": ["Busboy"] }], // Allow Busboy to be called without 'new'
  },
};
