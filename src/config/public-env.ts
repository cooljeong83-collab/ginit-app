import Constants from 'expo-constants';

/**
 * `app.config.ts`가 `env/.env`를 읽어 `expo.extra`에 넣은 공개 설정만 사용합니다.
 * (서비스 롤·네이버 client secret 등은 여기 포함하지 않습니다.)
 */
type Extra = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  firebaseApiKey?: string;
  firebaseAuthDomain?: string;
  firebaseProjectId?: string;
  firebaseStorageBucket?: string;
  firebaseMessagingSenderId?: string;
  firebaseAppId?: string;
  publicAppEnv?: string;
  publicApiBaseUrl?: string;
  naverMapClientId?: string;
  /**
   * NCP Maps Geocoding 등에 쓰는 Application **Client ID** → HTTP `X-NCP-APIGW-API-KEY-ID`
   * (env: NAVER_LOCAL_CLIENT_ID / EXPO_PUBLIC_NAVER_LOCAL_CLIENT_ID 등, app.config `pickExtra` 참고)
   */
  naverLocalClientId?: string;
  /** Application **Client Secret** → HTTP `X-NCP-APIGW-API-KEY` */
  naverLocalClientSecret?: string;
  /** 웹 전용: CORS 프록시 오리진 (끝 `/` 있어도 됨). 예: https://cors-anywhere.herokuapp.com/ */
  naverLocalSearchCorsProxy?: string;
  /** NCP Application Maps API 오리진 (기본 https://maps.apigw.ntruss.com — application-maps-overview) */
  naverMapsApiOrigin?: string;
  /**
   * Geocoding URI path (슬래시로 시작). 기본 `/map-geocode/v2/geocode`.
   * NCP Application의 Client ID·Secret은 아래 `naverLocal*` → 요청 헤더 `X-NCP-APIGW-API-KEY-ID` / `X-NCP-APIGW-API-KEY` 로 전달됨.
   */
  naverMapsGeocodePath?: string;
  /** Search API 지역 검색용 (openapi `X-Naver-Client-*`) */
  naverSearchClientId?: string;
  naverSearchClientSecret?: string;
  googleWebClientId?: string;
};

function extra(): Extra {
  return (Constants.expoConfig?.extra ?? {}) as Extra;
}

const e = extra();

/** 루트 `.env`의 EXPO_PUBLIC_* 폴백 (선택) */
export const publicEnv = {
  supabaseUrl: e.supabaseUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: e.supabaseAnonKey ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  firebaseApiKey: e.firebaseApiKey ?? process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  firebaseAuthDomain: e.firebaseAuthDomain ?? process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  firebaseProjectId: e.firebaseProjectId ?? process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  firebaseStorageBucket: e.firebaseStorageBucket ?? process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  firebaseMessagingSenderId:
    e.firebaseMessagingSenderId ?? process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  firebaseAppId: e.firebaseAppId ?? process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
  publicAppEnv: e.publicAppEnv ?? '',
  publicApiBaseUrl: e.publicApiBaseUrl ?? '',
  naverMapClientId: e.naverMapClientId ?? process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID ?? '',
  naverLocalClientId:
    e.naverLocalClientId ??
    process.env.EXPO_PUBLIC_NAVER_LOCAL_CLIENT_ID ??
    process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID ??
    '',
  naverLocalClientSecret: e.naverLocalClientSecret ?? process.env.EXPO_PUBLIC_NAVER_LOCAL_CLIENT_SECRET ?? '',
  naverLocalSearchCorsProxy:
    e.naverLocalSearchCorsProxy ?? process.env.EXPO_PUBLIC_NAVER_LOCAL_SEARCH_CORS_PROXY ?? '',
  naverMapsApiOrigin:
    (e.naverMapsApiOrigin?.trim() ||
      process.env.EXPO_PUBLIC_NAVER_MAPS_API_ORIGIN?.trim() ||
      process.env.EXPO_PUBLIC_NAVER_LOCAL_SEARCH_API_BASE?.trim() ||
      'https://maps.apigw.ntruss.com') as string,
  naverMapsGeocodePath:
    (e.naverMapsGeocodePath?.trim() ||
      process.env.EXPO_PUBLIC_NAVER_MAPS_GEOCODE_PATH?.trim() ||
      '/map-geocode/v2/geocode') as string,
  naverSearchClientId: e.naverSearchClientId ?? process.env.EXPO_PUBLIC_NAVER_SEARCH_CLIENT_ID ?? '',
  naverSearchClientSecret:
    e.naverSearchClientSecret ?? process.env.EXPO_PUBLIC_NAVER_SEARCH_CLIENT_SECRET ?? '',
  googleWebClientId: e.googleWebClientId ?? process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
};
