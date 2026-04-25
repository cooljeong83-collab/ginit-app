// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // `eslint-plugin-import`가 TS 모듈을 다시 파싱하는 과정에서 간헐적으로
      // "Parse errors in imported module"을 내며 린트를 실패시키는 케이스가 있어 비활성화합니다.
      'import/namespace': 'off',
    },
  },
]);
