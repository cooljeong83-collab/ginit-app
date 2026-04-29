/**
 * Injects Google Maps Android API key into AndroidManifest.xml:
 * <meta-data android:name="com.google.android.geo.API_KEY" android:value="..."/>
 */
const { withAndroidManifest } = require('@expo/config-plugins');

/** @type {import('@expo/config-plugins').ConfigPlugin} */
module.exports = function withAndroidGoogleMapsApiKey(config) {
  return withAndroidManifest(config, (mod) => {
    const apiKey = config.android?.config?.googleMaps?.apiKey;
    if (typeof apiKey !== 'string' || apiKey.trim() === '') {
      return mod;
    }

    const manifest = mod.modResults;
    const app = manifest.manifest?.application?.[0];
    if (!app) return mod;

    const meta = (app['meta-data'] ?? []);
    const nextMeta = Array.isArray(meta) ? meta.slice() : [];

    const name = 'com.google.android.geo.API_KEY';
    const existingIdx = nextMeta.findIndex((m) => m?.$?.['android:name'] === name);
    const entry = { $: { 'android:name': name, 'android:value': apiKey.trim() } };

    if (existingIdx >= 0) {
      nextMeta[existingIdx] = entry;
    } else {
      nextMeta.push(entry);
    }

    app['meta-data'] = nextMeta;
    return mod;
  });
};

