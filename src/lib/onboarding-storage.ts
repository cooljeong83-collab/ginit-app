import AsyncStorage from '@react-native-async-storage/async-storage';

/** 회원가입 직후 앱 소개 슬라이드 완료 여부(기기 단위, SharedPreferences와 동일 역할) */
const APP_INTRO_KEY = 'ginit.appIntroOnboarding.v1';

export async function readAppIntroComplete(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(APP_INTRO_KEY);
    return v === '1';
  } catch {
    return false;
  }
}

export async function writeAppIntroComplete(): Promise<void> {
  await AsyncStorage.setItem(APP_INTRO_KEY, '1');
}
