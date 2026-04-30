/**
 * Notifee: `app.notifee:core` 로컬 Maven — 반드시 allprojects.repositories 에만 추가
 * (buildscript 첫 mavenCentral() 뒤에 넣으면 classpath 전용이라 :app 에서 해석 안 됨)
 */
const { withProjectBuildGradle } = require('@expo/config-plugins');

const SNIPPET =
  '\n    maven { url "$rootDir/../node_modules/@notifee/react-native/android/libs" }\n';

const ALLPROJECTS_REPO_ANCHOR = `allprojects {
  repositories {
    google()
    mavenCentral()`;

/** @type {import('@expo/config-plugins').ConfigPlugin} */
module.exports = function withAndroidNotifeeMaven(config) {
  return withProjectBuildGradle(config, (mod) => {
    let src = mod.modResults.contents;
    if (src.includes('@notifee/react-native/android/libs')) {
      return mod;
    }
    const idx = src.indexOf(ALLPROJECTS_REPO_ANCHOR);
    if (idx === -1) {
      return mod;
    }
    const insertAt = idx + ALLPROJECTS_REPO_ANCHOR.length;
    mod.modResults.contents = src.slice(0, insertAt) + SNIPPET + src.slice(insertAt);
    return mod;
  });
};
