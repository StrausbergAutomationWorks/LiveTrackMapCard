import globals from "globals";
import pluginJs from "@eslint/js";
import jsdoc from 'eslint-plugin-jsdoc';


export default [
  {languageOptions: { globals: globals.browser }},
  // Tests run under jest; the build and its config run under Node.
  {files: ["**/*.test.js"], languageOptions: { globals: globals.jest }},
  // A test may choose its jest environment in a docblock.
  {files: ["**/*.test.js"], rules: { "jsdoc/check-tag-names": ["warn", { definedTags: ["jest-environment"] }] }},
  // Test helpers that decode fixtures run under the node environment.
  {files: ["**/*.testhelper.js"], languageOptions: { globals: globals.node }},
  {files: ["build/**/*.js", "build/**/*.mjs", "rollup.config.js", "jest.config.js"], languageOptions: { globals: globals.node }},
  pluginJs.configs.recommended,
  jsdoc.configs['flat/recommended'],
  {
    plugins: {
      jsdoc,
    },
    rules: {
      'jsdoc/require-returns-description': 0,
      'jsdoc/require-param-description': 0
    }
  }
];