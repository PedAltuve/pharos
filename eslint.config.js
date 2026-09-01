import base from "./eslint.config.base.js";

export default [
  ...base,
  { ignores: ["dist/**", "coverage/**", "tests/fixtures/**"] },
];
