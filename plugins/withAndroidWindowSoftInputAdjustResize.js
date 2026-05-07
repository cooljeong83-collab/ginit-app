/**
 * MainActivity에 android:windowSoftInputMode="adjustResize" 설정.
 * 키보드 올라올 때 레이아웃 리사이즈(채팅 입력 등)용.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

/** @type {import('@expo/config-plugins').ConfigPlugin} */
module.exports = function withAndroidWindowSoftInputAdjustResize(config) {
  return withAndroidManifest(config, (mod) => {
    const root = mod.modResults.manifest;
    if (!root) return mod;

    const app = root.application?.[0];
    if (!app?.activity) return mod;

    const activities = Array.isArray(app.activity) ? app.activity : [app.activity];
    let applied = false;

    for (const activity of activities) {
      const filters = activity['intent-filter'];
      const filterList = Array.isArray(filters) ? filters : filters ? [filters] : [];
      for (const filter of filterList) {
        const actions = filter.action;
        const actionList = Array.isArray(actions) ? actions : actions ? [actions] : [];
        for (const action of actionList) {
          if (action?.$?.['android:name'] === 'android.intent.action.MAIN') {
            activity.$ = activity.$ ?? {};
            activity.$['android:windowSoftInputMode'] = 'adjustResize';
            applied = true;
            break;
          }
        }
        if (applied) break;
      }
      if (applied) break;
    }

    if (!applied && activities[0]) {
      activities[0].$ = activities[0].$ ?? {};
      activities[0].$['android:windowSoftInputMode'] = 'adjustResize';
    }

    return mod;
  });
};
