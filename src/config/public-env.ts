import Constants from 'expo-constants';

/**
 * `app.config.ts`가 `env/.env`를 읽어 `expo.extra`에 넣은 공개 설정만 사용합니다.
 * (서비스 롤·네이버 client secret 등은 여기 포함하지 않습니다.)
 */
type Extra = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  /** `firestore` | `supabase` — 공개 모임 피드 소스 */
  meetingListSource?: string;
  /** `firestore` | (비움=supabase) — 카테고리 마스터 소스 (Supabase URL·Anon 있으면 기본 supabase) */
  categoriesSource?: string;
  /** `firestore` | `supabase` — 프로필 읽기(getUserProfile) 소스 (기본 firestore) */
  profilesSource?: string;
  /** `firestore` 로 두면 모임·프로필을 Firestore에만 씀. 비우면 Supabase URL·Anon 있을 때 Ledger(Supabase) 사용 */
  ledgerWrites?: string;
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
  /** `1|true|yes` 이면 지역 검색 OpenAPI 응답 요약·샘플을 Metro 로그로 출력 */
  naverLocalSearchDebug?: string;
  googleWebClientId?: string;
  /** Google Places API(New) Text Search·사진 — 웹 서비스용(권장). 비우면 `googleMapsPlatformApiKey` 폴백 */
  googlePlacesApiKey?: string;
  /** Google Maps 플랫폼 API 키(예: Android SDK용) — Places 전용 키가 없을 때 사진 조회 폴백 */
  googleMapsPlatformApiKey?: string;
  /** Kakao 로컬 API(키워드 장소 검색) — REST API 키 */
  kakaoRestApiKey?: string;
  /** KOBIS(영화진흥위원회) 오픈API 키 — 일별 박스오피스 등 */
  kobisKey?: string;
  /** TMDB v3 API 키 — 제목 검색으로 포스터 URL */
  tmdbApiKey?: string;
  /** Expo Push 전송용(클라이언트는 개발만 권장). 프로덕션은 서버에서 전송하세요. */
  expoAccessToken?: string;
  easProjectId?: string;
};

function extra(): Extra {
  return (Constants.expoConfig?.extra ?? {}) as Extra;
}

const e = extra();

/** 루트 `.env`의 EXPO_PUBLIC_* 폴백 (선택) */
export const publicEnv: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  meetingListSource: string;
  categoriesSource: string;
  profilesSource: string;
  ledgerWrites: string;
  firebaseApiKey: string;
  firebaseAuthDomain: string;
  firebaseProjectId: string;
  firebaseStorageBucket: string;
  firebaseMessagingSenderId: string;
  firebaseAppId: string;
  publicAppEnv: string;
  publicApiBaseUrl: string;
  naverMapClientId: string;
  naverLocalClientId: string;
  naverLocalClientSecret: string;
  naverLocalSearchCorsProxy: string;
  naverMapsApiOrigin: string;
  naverMapsGeocodePath: string;
  naverSearchClientId: string;
  naverSearchClientSecret: string;
  naverLocalSearchDebug: string;
  googleWebClientId: string;
  googlePlacesApiKey: string;
  googleMapsPlatformApiKey: string;
  kakaoRestApiKey: string;
  kobisKey: string;
  tmdbApiKey: string;
  expoAccessToken: string;
  easProjectId: string;
} = {
  supabaseUrl: e.supabaseUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: e.supabaseAnonKey ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  meetingListSource:
    e.meetingListSource ?? process.env.EXPO_PUBLIC_MEETING_LIST_SOURCE ?? process.env.MEETING_LIST_SOURCE ?? '',
  categoriesSource:
    e.categoriesSource ?? process.env.EXPO_PUBLIC_CATEGORIES_SOURCE ?? process.env.CATEGORIES_SOURCE ?? '',
  profilesSource:
    e.profilesSource ?? process.env.EXPO_PUBLIC_PROFILE_SOURCE ?? process.env.PROFILE_SOURCE ?? '',
  ledgerWrites:
    e.ledgerWrites ?? process.env.EXPO_PUBLIC_LEDGER_WRITES ?? process.env.LEDGER_WRITES ?? '',
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
  naverLocalSearchDebug:
    e.naverLocalSearchDebug ?? process.env.EXPO_PUBLIC_NAVER_LOCAL_SEARCH_DEBUG ?? '',
  googleWebClientId: e.googleWebClientId ?? process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
  googlePlacesApiKey:
    e.googlePlacesApiKey ?? process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY ?? '',
  googleMapsPlatformApiKey:
    e.googleMapsPlatformApiKey ??
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ??
    process.env.GOOGLE_MAPS_ANDROID_API_KEY ??
    '',
  kakaoRestApiKey: e.kakaoRestApiKey ?? process.env.EXPO_PUBLIC_KAKAO_REST_API_KEY ?? process.env.KAKAO_REST_API_KEY ?? '',
  kobisKey: e.kobisKey ?? process.env.EXPO_PUBLIC_KOBIS_KEY ?? process.env.KOBIS_KEY ?? '',
  tmdbApiKey: e.tmdbApiKey ?? process.env.EXPO_PUBLIC_TMDB_API_KEY ?? process.env.TMDB_API_KEY ?? '',
  expoAccessToken: e.expoAccessToken ?? process.env.EXPO_PUBLIC_EXPO_ACCESS_TOKEN ?? '',
  easProjectId: e.easProjectId ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? process.env.EAS_PROJECT_ID ?? '',
};
