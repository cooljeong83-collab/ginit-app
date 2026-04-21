/**
 * Adds Google Play Services Auth dependency required by Android Phone Number Hint API wrappers.
 * - Needed for `rn-phonenumber-detector` (Phone Number Hint API).
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

const DEP = "implementation 'com.google.android.gms:play-services-auth:21.0.0'";

/** @type {import('@expo/config-plugins').ConfigPlugin} */
module.exports = function withAndroidPlayServicesAuth(config) {
  return withAppBuildGradle(config, (mod) => {
    let src = mod.modResults.contents;
    if (src.includes('com.google.android.gms:play-services-auth')) {
      return mod;
    }

    // Insert into dependencies { ... } block
    const marker = 'dependencies {';
    const idx = src.indexOf(marker);
    if (idx === -1) {
      return mod;
    }
    const insertAt = idx + marker.length;
    src = `${src.slice(0, insertAt)}\n    ${DEP}${src.slice(insertAt)}`;
    mod.modResults.contents = src;
    return mod;
  });
};

