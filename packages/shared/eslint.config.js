import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    ignores: ["dist/**"]
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module"
    },
    rules: {
      "no-unused-vars": "off"
    }
  }
];

