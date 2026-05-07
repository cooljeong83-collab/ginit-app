/**
 * android/app/build.gradle에 ABI splits 설정을 주입합니다.
 * - enable true
 * - universalApk false
 *
 * `/android`가 gitignore된 Expo(prebuild) 구조에서, 매 prebuild마다 설정이 유실되지 않게 하기 위함입니다.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
const glob = require('glob');
 
const INSERT_MARKER = 'ginit:abi-splits';
 
function ensureAbiSplitsInAppBuildGradle(contents) {
  if (contents.includes(INSERT_MARKER)) return contents;
 
  // android { ... } 블록 안에 넣는 것이 가장 안전합니다.
  const androidBlockMatch = contents.match(/(^|\n)\s*android\s*\{\s*\n/);
  if (!androidBlockMatch || androidBlockMatch.index === undefined) {
    return contents;
  }
 
  const insertAt = androidBlockMatch.index + androidBlockMatch[0].length;
 
  const snippet =
    `    // ${INSERT_MARKER}\n` +
    `    splits {\n` +
    `        abi {\n` +
    `            enable true\n` +
    `            reset()\n` +
    `            include "armeabi-v7a", "arm64-v8a", "x86", "x86_64"\n` +
    `            universalApk false\n` +
    `        }\n` +
    `    }\n\n`;
 
  return contents.slice(0, insertAt) + snippet + contents.slice(insertAt);
}
 
/** @type {import('@expo/config-plugins').ConfigPlugin} */
module.exports = function withAndroidAbiSplits(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const matches = glob.sync('android/app/build.gradle', {
        cwd: projectRoot,
        absolute: true,
      });
 
      const buildGradlePath = matches[0] ?? path.join(projectRoot, 'android', 'app', 'build.gradle');
      if (!fs.existsSync(buildGradlePath)) return cfg;
 
      const contents = fs.readFileSync(buildGradlePath, 'utf8');
      const newContents = ensureAbiSplitsInAppBuildGradle(contents);
      if (newContents !== contents) {
        fs.writeFileSync(buildGradlePath, newContents);
      }
      return cfg;
    },
  ]);
};
