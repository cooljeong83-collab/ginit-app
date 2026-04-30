/**
 * Android 12+ 시스템 스플래시 아이콘을 런처와 동일한 Adaptive Icon `@mipmap/ic_launcher`로 지정합니다.
 * `expo-splash-screen` 이후 플러그인 배열에 두세요.
 */
const { AndroidConfig, withAndroidStyles } = require('@expo/config-plugins');

const SPLASH_THEME = {
  name: 'Theme.App.SplashScreen',
  parent: 'AppTheme',
};

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withAndroidSplashLauncherForeground = (config) =>
  withAndroidStyles(config, (mod) => {
    let xml = mod.modResults;
    xml = AndroidConfig.Styles.setStylesItem({
      xml,
      parent: SPLASH_THEME,
      item: { $: { name: 'windowSplashScreenAnimatedIcon' }, _: '@mipmap/ic_launcher' },
    });
    xml = AndroidConfig.Styles.setStylesItem({
      xml,
      parent: SPLASH_THEME,
      item: { $: { name: 'windowSplashScreenBackground' }, _: '@color/splashscreen_background' },
    });
    mod.modResults = xml;
    return mod;
  });

module.exports = withAndroidSplashLauncherForeground;
