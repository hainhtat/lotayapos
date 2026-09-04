import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "*.ts"],
    languageOptions: { parser: tseslint.parser, parserOptions: { sourceType: "module" } },
    rules: {},
  },
);
