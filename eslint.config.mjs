import globals from "globals";
import pluginJs from "@eslint/js";
import jsdoc from 'eslint-plugin-jsdoc';


export default [
  {languageOptions: { globals: globals.browser }},
  // Tests run under jest; the build and its config run under Node.
  {files: ["**/*.test.js"], languageOptions: { globals: globals.jest }},
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