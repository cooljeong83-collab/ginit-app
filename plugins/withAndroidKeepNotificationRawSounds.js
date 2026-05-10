/**
 * shrinkResources 시 expo-notifications가 복사한 @raw/*.wav 가
 * 동적 getIdentifier 조회만으로는 링크되지 않아 제거될 수 있어,
 * 두 알림음을 명시적으로 유지합니다. (지닛 벨 1만 시스템 기본으로 떨어지는 회귀 방지)
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

/** @type {import('@expo/config-plugins').ConfigPlugin} */
module.exports = function withAndroidKeepNotificationRawSounds(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const root = cfg.modRequest.projectRoot;
      const valuesDir = path.join(root, 'android/app/src/main/res/values');
      const out = path.join(valuesDir, 'ginit_notification_sounds_keep.xml');
      if (!fs.existsSync(valuesDir)) {
        fs.mkdirSync(valuesDir, { recursive: true });
      }
      const body = `<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:tools="http://schemas.android.com/tools"
  tools:keep="@raw/ginit_bell_1,@raw/ginit_ring_c1" />
`;
      fs.writeFileSync(out, body, 'utf8');
      return cfg;
    },
  ]);
};
