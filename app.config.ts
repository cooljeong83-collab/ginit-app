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

  return out;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const naverClientId =
    process.env.NAVER_MAP_CLIENT_ID ?? process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID ?? '';

  /** Google Maps SDK (Android / iOS) — `react-native-maps` + `PROVIDER_GOOGLE` 용. 스토어 빌드 시 필수. */
  const googleMapsApiKey =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    '';

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
      ...(googleMapsApiKey
        ? {
            config: {
              ...(config.ios as { config?: Record<string, unknown> } | undefined)?.config,
              googleMapsApiKey,
            },
          }
        : {}),
    },
    android: {
      ...config.android,
      package: 'com.ginit.app',
      googleServicesFile: './env/google-services.json',
      permissions: [...((config.android as { permissions?: string[] } | undefined)?.permissions ?? [])],
      ...(googleMapsApiKey
        ? {
            config: {
              ...(config.android as { config?: { googleMaps?: Record<string, unknown> } } | undefined)?.config,
              googleMaps: {
                ...((config.android as { config?: { googleMaps?: Record<string, unknown> } } | undefined)?.config
                  ?.googleMaps ?? {}),
                apiKey: googleMapsApiKey,
              },
            },
          }
        : {}),
    },
    plugins: [
      ...plugins,
      '@react-native-community/datetimepicker',
      '@react-native-google-signin/google-signin',
      [
        '@mj-studio/react-native-naver-map',
        {
          client_id: naverClientId,
        },
      ],
      [
        'expo-build-properties',
        {
          android: {
            extraMavenRepos: ['https://repository.map.naver.com/archive/maven'],
          },
        },
      ],
    ],
    extra: {
      ...baseExtra,
      ...pickExtra(),
    },
  };
};
