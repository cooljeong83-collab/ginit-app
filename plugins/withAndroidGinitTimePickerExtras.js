/**
 * datetimepicker config plugin 이후 적용:
 * - 취소/확인 다이얼로그 버튼 강조색 (timePickerDialogTheme)
 *
 * 헤더(큰 시각) 글자색은 `Widget.Material.Light.TimePicker` 기본값(배경 강조색 대비)을 쓰고,
 * `app.config.ts`의 headerBackground(#4527A0)만 덮어씁니다.
 * `headerTextColor`는 framework private attr라 앱 styles에서 지정 불가.
 */
const { AndroidConfig, withAndroidStyles } = require('@expo/config-plugins');

const GINIT_DEEP_PURPLE = '#4527A0';
const APP_THEME = AndroidConfig.Styles.getAppThemeGroup();
const TIME_PICKER_DIALOG_THEME = {
  name: 'TimePickerDialogTheme',
  parent: 'Theme.AppCompat.Light.Dialog',
};

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withAndroidGinitTimePickerExtras = (config) => {
  config = withAndroidStyles(config, (mod) => {
    let xml = mod.modResults;

    xml = AndroidConfig.Styles.assignStylesValue(xml, {
      add: true,
      parent: TIME_PICKER_DIALOG_THEME,
      name: 'colorAccent',
      value: GINIT_DEEP_PURPLE,
    });
    xml = AndroidConfig.Styles.assignStylesValue(xml, {
      add: true,
      parent: TIME_PICKER_DIALOG_THEME,
      name: 'colorPrimary',
      value: GINIT_DEEP_PURPLE,
    });
    xml = AndroidConfig.Styles.assignStylesValue(xml, {
      add: true,
      parent: TIME_PICKER_DIALOG_THEME,
      name: 'android:colorControlActivated',
      value: GINIT_DEEP_PURPLE,
    });

    xml = AndroidConfig.Styles.assignStylesValue(xml, {
      add: true,
      parent: APP_THEME,
      name: 'android:timePickerDialogTheme',
      value: '@style/TimePickerDialogTheme',
    });

    mod.modResults = xml;
    return mod;
  });

  return config;
};

module.exports = withAndroidGinitTimePickerExtras;
