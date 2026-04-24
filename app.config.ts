import path from 'path';
import { config as loadEnv } from 'dotenv';
import type { ConfigContext, ExpoConfig } from 'expo/config';

loadEnv({ path: path.resolve(__dirname, 'env/.env') });

function pickExtra(): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (key: string, value: string | undefined) => {
    if (value !== undefined && value !== '') out[key] = value;
  };

  set('supabaseUrl', process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL);
  set('supabaseAnonKey', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY);
  set('meetingListSource', process.env.EXPO_PUBLIC_MEETING_LIST_SOURCE ?? process.env.MEETING_LIST_SOURCE);
  set('categoriesSource', process.env.EXPO_PUBLIC_CATEGORIES_SOURCE ?? process.env.CATEGORIES_SOURCE);
  set('profilesSource', process.env.EXPO_PUBLIC_PROFILE_SOURCE ?? process.env.PROFILE_SOURCE);
  set('ledgerWrites', process.env.EXPO_PUBLIC_LEDGER_WRITES ?? process.env.LEDGER_WRITES);
  set('firebaseApiKey', process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? process.env.FIREBASE_API_KEY);
  set('firebaseAuthDomain', process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? process.env.FIREBASE_AUTH_DOMAIN);
  set('firebaseProjectId', process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID);
  set(
    'firebaseStorageBucket',
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? process.env.FIREBASE_STORAGE_BUCKET,
  );
  set(
    'firebaseMessagingSenderId',
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? process.env.FIREBASE_MESSAGING_SENDER_ID,
  );
  set('firebaseAppId', process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? process.env.FIREBASE_APP_ID);
  set('publicAppEnv', process.env.EXPO_PUBLIC_APP_ENV ?? process.env.PUBLIC_APP_ENV);
  set('publicApiBaseUrl', process.env.EXPO_PUBLIC_API_BASE_URL ?? process.env.PUBLIC_API_BASE_URL);
  set('naverMapClientId', process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID ?? process.env.NAVER_MAP_CLIENT_ID);
  set(
    'naverLocalClientId',
    process.env.EXPO_PUBLIC_NAVER_LOCAL_CLIENT_ID ??
      process.env.NAVER_LOCAL_CLIENT_ID ??
      process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID ??
      process.env.NAVER_MAP_CLIENT_ID,
  );
  set('naverLocalClientSecret', process.env.NAVER_LOCAL_CLIENT_SECRET ?? process.env.EXPO_PUBLIC_NAVER_LOCAL_CLIENT_SECRET);
  /** 네이버 개발자센터 Search API (지역 검색) — openapi는 X-Naver-Client-* 만 사용 */
  set(
    'naverSearchClientId',
    process.env.EXPO_PUBLIC_NAVER_SEARCH_CLIENT_ID ?? process.env.NAVER_SEARCH_CLIENT_ID,
  );
  set(
    'naverSearchClientSecret',
    process.env.EXPO_PUBLIC_NAVER_SEARCH_CLIENT_SECRET ?? process.env.NAVER_SEARCH_CLIENT_SECRET,
  );
  /** 웹 CORS 우회: 예) https://cors-anywhere.herokuapp.com (개발 전용, 끝 슬래시 없이도 됨) */
  set(
    'naverLocalSearchCorsProxy',
    process.env.EXPO_PUBLIC_NAVER_LOCAL_SEARCH_CORS_PROXY ?? process.env.NAVER_LOCAL_SEARCH_CORS_PROXY,
  );
  /** NCP Application Maps 호스트 (기본 https://maps.apigw.ntruss.com — application-maps-overview) */
  set(
    'naverMapsApiOrigin',
    process.env.EXPO_PUBLIC_NAVER_MAPS_API_ORIGIN ??
      process.env.NAVER_MAPS_API_ORIGIN ??
      process.env.EXPO_PUBLIC_NAVER_LOCAL_SEARCH_API_BASE ??
      process.env.NAVER_LOCAL_SEARCH_API_BASE,
  );
  /** Geocoding 경로 (기본 /map-geocode/v2/geocode). 잘못된 /map-geocoding/v2/search 는 404 */
  set(
    'naverMapsGeocodePath',
    process.env.EXPO_PUBLIC_NAVER_MAPS_GEOCODE_PATH ?? process.env.NAVER_MAPS_GEOCODE_PATH,
  );
  set(
    'googleWebClientId',
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ??
      process.env.EXPO_PUBLIC_WEB_CLIENT_ID ??
      process.env.WEB_CLIENT_ID,
  );
  set('kobisKey', process.env.EXPO_PUBLIC_KOBIS_KEY ?? process.env.KOBIS_KEY);
  set('tmdbApiKey', process.env.EXPO_PUBLIC_TMDB_API_KEY ?? process.env.TMDB_API_KEY);
  set('expoAccessToken', process.env.EXPO_PUBLIC_EXPO_ACCESS_TOKEN ?? process.env.EXPO_ACCESS_TOKEN);
  set('easProjectId', process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? process.env.EAS_PROJECT_ID);

  return out;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const naverClientId =
    process.env.NAVER_MAP_CLIENT_ID ?? process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID ?? '';

  const plugins = (config.plugins ?? []).filter((entry) => {
    if (entry === 'expo-build-properties') return false;
    if (Array.isArray(entry) && entry[0] === 'expo-build-properties') return false;
    return true;
  });

  const baseExtra =
    config.extra && typeof config.extra === 'object' && !Array.isArray(config.extra)
      ? (config.extra as Record<string, unknown>)
      : {};

  return {
    ...config,
    name: config.name ?? 'ginit-app',
    slug: config.slug ?? 'ginit-app',
    ios: {
      ...config.ios,
      bundleIdentifier: 'com.ginit.app',
    },
    android: {
      ...config.android,
      /** 키보드가 올라올 때 입력창이 가려지지 않도록(채팅 등) — app.json과 동일 권장값 */
      softwareKeyboardLayoutMode: 'resize',
      /** Adaptive icon 캐시 우회: foreground 이미지를 v2로 고정 */
      adaptiveIcon: {
        ...((config.android as { adaptiveIcon?: Record<string, unknown> } | undefined)?.adaptiveIcon ?? {}),
        foregroundImage: './assets/images/android-icon-foreground-v2.png',
      },
      package: 'com.ginit.app',
      googleServicesFile: './env/google-services.json',
    },
    plugins: [
      ...plugins,
      'expo-secure-store',
      '@react-native-google-signin/google-signin',
      [
        'expo-speech-recognition',
        {
          microphonePermission: '음성 입력을 위해 마이크 접근이 필요합니다.',
          speechRecognitionPermission: '음성 입력을 위해 음성 인식 접근이 필요합니다.',
          androidSpeechServicePackages: ['com.google.android.googlequicksearchbox'],
        },
      ],
      [
        '@mj-studio/react-native-naver-map/app.plugin.js',
        {
          client_id: naverClientId,
        },
      ],
      [
        'expo-build-properties',
        {
          ios: {
            /**
             * FirebaseAuth (Swift) pods fail to integrate as static libraries unless modular headers are enabled.
             * Using dynamic frameworks avoids the modular-headers requirement and makes `pod install` succeed.
             */
            useFrameworks: 'dynamic',
          },
          android: {
            extraMavenRepos: ['https://repository.map.naver.com/archive/maven'],
          },
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/images/icon.png',
          color: '#0052CC',
          sounds: [],
        },
      ],
      /** Android Phone Number Hint API (play-services-auth) */
      './plugins/withAndroidPlayServicesAuth.js',
      /** Android 스플래시 아이콘을 Adaptive 전경(`ic_launcher_foreground`)과 동일하게 */
      './plugins/withAndroidSplashLauncherForeground.js',
    ],
    extra: {
      ...baseExtra,
      ...pickExtra(),
      eas: {
        ...(typeof baseExtra.eas === 'object' && baseExtra.eas !== null && !Array.isArray(baseExtra.eas)
          ? (baseExtra.eas as Record<string, unknown>)
          : {}),
        projectId:
          process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
          process.env.EAS_PROJECT_ID ??
          (typeof baseExtra.eas === 'object' &&
          baseExtra.eas !== null &&
          !Array.isArray(baseExtra.eas) &&
          typeof (baseExtra.eas as { projectId?: string }).projectId === 'string'
            ? (baseExtra.eas as { projectId: string }).projectId
            : undefined),
      },
    },
  };
};
