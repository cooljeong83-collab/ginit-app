/**
 * Force ExpoRootProjectPlugin's `ndkVersion` default override.
 *
 * Expo SDK 54 uses `expo-root-project` Gradle plugin which sets `rootProject.extra["ndkVersion"]`
 * only if it doesn't already exist. To override the default (27.1.12297006), we must define
 * `ext.ndkVersion` BEFORE `apply plugin: "expo-root-project"` runs.
 */
const { withProjectBuildGradle } = require('@expo/config-plugins');

/** @type {import('@expo/config-plugins').ConfigPlugin<{ ndkVersion: string } | void>} */
module.exports = function withAndroidNdkVersionExt(config, props) {
  const ndkVersion = (props && typeof props.ndkVersion === 'string' ? props.ndkVersion : '').trim();
  if (!ndkVersion) return config;

  return withProjectBuildGradle(config, (mod) => {
    let src = mod.modResults.contents;
    const tag = 'ginit: ndkVersion ext override';
    if (src.includes(tag)) return mod;

    const block = `\n// --- ${tag} ---\next.ndkVersion = \"${ndkVersion}\"\n// --- /${tag} ---\n`;
    const needle = 'apply plugin: "expo-root-project"';
    const idx = src.indexOf(needle);
    if (idx !== -1) {
      src = `${src.slice(0, idx)}${block}${src.slice(idx)}`;
    } else {
      src = `${src.trimEnd()}\n${block}\n`;
    }
    mod.modResults.contents = src;
    return mod;
  });
};

