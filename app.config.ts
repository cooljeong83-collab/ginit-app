import fs from 'node:fs';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import type { ConfigContext, ExpoConfig } from 'expo/config';

loadEnv({ path: path.resolve(__dirname, 'env/.env'), quiet: true });

/** iOS `@react-native-firebase/*` — plist가 있을 때만 네이티브에 연결합니다. */
function resolveIosGoogleServicesFile(): string | undefined {
  const abs = path.resolve(__dirname, 'env/GoogleService-Info.plist');
  return fs.existsSync(abs) ? './env/GoogleService-Info.plist' : undefined;
}

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
  /** Places(New) 레거시 키 — 지도 SDK 등. 장소 텍스트 검색은 Kakao `kakaoRestApiKey` 사용 */
  set(
    'googlePlacesApiKey',
    process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY,
  );
  set(
    'googleMapsPlatformApiKey',
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ??
      process.env.GOOGLE_MAPS_ANDROID_API_KEY,
  );
  set('kakaoRestApiKey', process.env.EXPO_PUBLIC_KAKAO_REST_API_KEY ?? process.env.KAKAO_REST_API_KEY);

  return out;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const iosGoogleServicesFile = resolveIosGoogleServicesFile();
  const naverClientId =
    process.env.NAVER_MAP_CLIENT_ID ?? process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID ?? '';

  const googleMapsAndroidApiKey =
    process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ?? '';

  const plugins = (config.plugins ?? []).filter((entry) => {
    if (entry === 'expo-build-properties') return false;
    if (Array.isArray(entry) && entry[0] === 'expo-build-properties') return false;
    return true;
  });

  const baseExtra =
    config.extra && typeof config.extra === 'object' && !Array.isArray(config.extra)
      ? (config.extra as Record<string, unknown>)
      : {};

  const out: any = {
    ...config,
    name: config.name ?? 'ginit-app',
    slug: config.slug ?? 'ginit-app',
    statusBar: {
      ...(typeof (config as { statusBar?: Record<string, unknown> }).statusBar === 'object'
        ? ((config as { statusBar?: Record<string, unknown> }).statusBar as Record<string, unknown>)
        : {}),
      style: 'dark',
      translucent: true,
      backgroundColor: '#00000000',
    },
    ios: {
      ...config.ios,
      bundleIdentifier: 'com.ginit.app',
      ...(iosGoogleServicesFile ? { googleServicesFile: iosGoogleServicesFile } : {}),
    },
    android: {
      ...config.android,
      permissions: Array.from(
        new Set([
          ...(((config.android as { permissions?: string[] } | undefined)?.permissions ?? []) as string[]),
          'WAKE_LOCK',
          'RECEIVE_BOOT_COMPLETED',
        ]),
      ),
      config: {
        ...((config.android as { config?: Record<string, unknown> } | undefined)?.config ?? {}),
        googleMaps: {
          ...(((config.android as { config?: any } | undefined)?.config?.googleMaps as Record<string, unknown>) ?? {}),
          apiKey: googleMapsAndroidApiKey,
        },
      },
      /** 키보드가 올라올 때 입력창이 가려지지 않도록(채팅 등) — app.json과 동일 권장값 */
      softwareKeyboardLayoutMode: 'resize',
      /** Adaptive icon 캐시 우회: foreground 이미지를 v2로 고정 */
      adaptiveIcon: {
        ...((config.android as { adaptiveIcon?: Record<string, unknown> } | undefined)?.adaptiveIcon ?? {}),
        foregroundImage: './assets/images/android_icon_foreground_v2.png',
      },
      package: 'com.ginit.app',
      googleServicesFile: './env/google-services.json',
    },
    androidStatusBar: {
      ...(typeof (config as { androidStatusBar?: Record<string, unknown> }).androidStatusBar === 'object'
        ? ((config as { androidStatusBar?: Record<string, unknown> }).androidStatusBar as Record<string, unknown>)
        : {}),
      barStyle: 'dark-content',
      translucent: true,
      backgroundColor: '#FFFFFF',
    },
    plugins: [
      ...plugins,
      '@react-native-google-signin/google-signin/app.plugin.js',
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
            deploymentTarget: '15.1',
            /**
             * FirebaseAuth (Swift) pods fail to integrate as static libraries unless modular headers are enabled.
             * Using dynamic frameworks avoids the modular-headers requirement and makes `pod install` succeed.
             */
            useFrameworks: 'dynamic',
          },
          android: {
            extraMavenRepos: ['https://repository.map.naver.com/archive/maven'],
            /**
             * Android 16KB page size 호환:
             * - NDK r28+ : 16KB ELF alignment 기본
             * - AGP 8.5.1+ : 16KB zip alignment 처리
             */
            ndkVersion: '28.0.12433566',
            androidGradlePluginVersion: '8.6.0',
          },
        },
      ],
      ['./plugins/withAndroidNdkVersionExt.js', { ndkVersion: '28.0.12433566' }],
      /**
       * Android 상태바·알림: 단색(흰 실루엣) + 투명 배경 PNG → OS가 밝기에 맞춰 틴트(밝은 배경=어두운 아이콘 등).
       * `color` 미지정 → 고정 브랜드 원 배경 없이 시스템 기본 처리.
       * 소스: `assets/images/notification_icon_monochrome.png` (재생성 시 android drawable은 `expo prebuild` 또는 scripts 참고)
       */
      [
        'expo-notifications',
        {
          icon: './assets/images/notification_icon_monochrome.png',
          sounds: ['./assets/sounds/ginit_ring_w.wav'],
          /** FCM v1: 페이로드에 channelId가 없을 때 기본으로 쓸 채널(앱 종료·콜드 스타트 수신 보강) */
          defaultChannel: 'default',
        },
      ],
      './plugins/withAndroidFcmDefaultChannelManifest.js',
      'expo-background-fetch',
      /** Android Phone Number Hint API (play-services-auth) */
      './plugins/withAndroidPlayServicesAuth.js',
      './plugins/withAndroidNotifeeMaven.js',
      /** Android 스플래시 아이콘을 Adaptive 전경(`ic_launcher_foreground`)과 동일하게 */
      './plugins/withAndroidSplashLauncherForeground.js',
      /** Google Maps SDK API key (`com.google.android.geo.API_KEY`) */
      './plugins/withAndroidGoogleMapsApiKey.js',
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
  return out as ExpoConfig;
};
