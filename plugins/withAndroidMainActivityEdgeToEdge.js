/**
 * MainActivity.onCreate에 WindowCompat.setDecorFitsSystemWindows(window, false) 삽입.
 * Edge-to-edge 인셋은 react-native-keyboard-controller 등과 함께 JS/인셋 API로 맞춥니다.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const glob = require('glob');

const MARKER = 'WindowCompat.setDecorFitsSystemWindows(window, false)';

/** @type {import('@expo/config-plugins').ConfigPlugin} */
module.exports = function withAndroidMainActivityEdgeToEdge(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const matches = glob.sync('android/app/src/main/java/**/MainActivity.@(java|kt)', {
        cwd: projectRoot,
        absolute: true,
      });
      const filePath = matches[0];
      if (!filePath) return cfg;

      let contents = fs.readFileSync(filePath, 'utf8');
      if (contents.includes(MARKER)) return cfg;

      const isKt = filePath.endsWith('.kt');
      if (isKt) {
        if (!contents.includes('androidx.core.view.WindowCompat')) {
          const pkgMatch = contents.match(/^package\s+[^\n]+\n/m);
          const insertAt = pkgMatch ? pkgMatch.index + pkgMatch[0].length : 0;
          contents =
            contents.slice(0, insertAt) + 'import androidx.core.view.WindowCompat\n' + contents.slice(insertAt);
        }
        const afterSuper = contents.match(/super\.onCreate\([^)]*\)\s*\n/);
        if (afterSuper && afterSuper.index !== undefined) {
          const end = afterSuper.index + afterSuper[0].length;
          contents = `${contents.slice(0, end)}    ${MARKER}\n${contents.slice(end)}`;
        }
      } else {
        if (!contents.includes('androidx.core.view.WindowCompat')) {
          const pkgMatch = contents.match(/^package\s+[^;]+;\s*\n/m);
          const insertAt = pkgMatch ? pkgMatch.index + pkgMatch[0].length : 0;
          contents =
            contents.slice(0, insertAt) + 'import androidx.core.view.WindowCompat;\n' + contents.slice(insertAt);
        }
        const afterSuper = contents.match(/super\.onCreate\([^)]*\);\s*\n/);
        if (afterSuper && afterSuper.index !== undefined) {
          const end = afterSuper.index + afterSuper[0].length;
          contents = `${contents.slice(0, end)}    ${MARKER};\n${contents.slice(end)}`;
        }
      }

      fs.writeFileSync(filePath, contents);
      return cfg;
    },
  ]);
};
