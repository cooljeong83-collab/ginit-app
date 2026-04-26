/**
 * Work around aapt2 "Invalid <color>" failures coming from certain
 * Google Play Services AAR resource XMLs (e.g. play-services-base 18.5.0).
 *
 * We force known-good versions so Gradle doesn't resolve the problematic one.
 */
const { withProjectBuildGradle } = require('@expo/config-plugins');

const FORCE_BLOCK = `

// --- ginit: force GMS versions (aapt2 resource workaround) ---
allprojects {
  configurations.all {
    resolutionStrategy {
      force "com.google.android.gms:play-services-base:18.5.0"
      force "com.google.android.gms:play-services-tasks:18.2.0"
    }
  }
}
// --- /ginit ---
`;

/** @type {import('@expo/config-plugins').ConfigPlugin} */
module.exports = function withAndroidGmsResourceFix(config) {
  return withProjectBuildGradle(config, (mod) => {
    let src = mod.modResults.contents;
    if (src.includes('ginit: force GMS versions')) {
      return mod;
    }

    // Insert after the existing allprojects { repositories { ... } } block if present,
    // otherwise append to the end of the file.
    const allprojectsIdx = src.indexOf('allprojects {');
    if (allprojectsIdx !== -1) {
      // Place the force block after the first allprojects block closes.
      const closeIdx = src.indexOf('}\n', allprojectsIdx);
      if (closeIdx !== -1) {
        const insertAt = closeIdx + 2;
        src = `${src.slice(0, insertAt)}${FORCE_BLOCK}${src.slice(insertAt)}`;
        mod.modResults.contents = src;
        return mod;
      }
    }

    src = `${src.trimEnd()}\n${FORCE_BLOCK}\n`;
    mod.modResults.contents = src;
    return mod;
  });
};

