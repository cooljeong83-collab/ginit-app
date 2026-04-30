/**
 * expo-notifications `defaultChannel` vs @react-native-firebase/messaging 기본 meta-data 값 충돌 시
 * 머지 오류 방지: `tools:replace="android:value"` 부여 (prebuild 후에도 유지)
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const META_NAME = 'com.google.firebase.messaging.default_notification_channel_id';

/** @type {import('@expo/config-plugins').ConfigPlugin} */
module.exports = function withAndroidFcmDefaultChannelManifest(config) {
  return withAndroidManifest(config, (mod) => {
    const root = mod.modResults.manifest;
    if (!root) return mod;
    root.$ = root.$ ?? {};
    if (!root.$['xmlns:tools']) {
      root.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    const app = root.application?.[0];
    if (!app) return mod;

    const meta = app['meta-data'];
    const list = Array.isArray(meta) ? meta.slice() : meta ? [meta] : [];
    let found = false;
    for (const item of list) {
      if (item?.$?.['android:name'] === META_NAME) {
        item.$['android:value'] = item.$['android:value'] ?? 'default';
        item.$['tools:replace'] = 'android:value';
        found = true;
      }
    }
    if (!found) {
      list.push({
        $: {
          'android:name': META_NAME,
          'android:value': 'default',
          'tools:replace': 'android:value',
        },
      });
    }
    app['meta-data'] = list;
    return mod;
  });
};
