import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';
import { getFirestore, initializeFirestore, type Firestore } from 'firebase/firestore';
import { Platform } from 'react-native';

import { publicEnv } from '@/src/config/public-env';

const firebaseConfig = {
  apiKey: publicEnv.firebaseApiKey,
  authDomain: publicEnv.firebaseAuthDomain,
  projectId: publicEnv.firebaseProjectId,
  storageBucket: publicEnv.firebaseStorageBucket,
  messagingSenderId: publicEnv.firebaseMessagingSenderId,
  appId: publicEnv.firebaseAppId,
};

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let firestore: Firestore | undefined;

/**
 * Firebase JS SDK 초기화 (Expo 권장 경로).
 * Android 네이티브 설정은 `env/google-services.json` 등으로 별도 구성합니다.
 */
export function getFirebaseApp(): FirebaseApp {
  if (app) return app;
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    throw new Error(
      '[firebase] env/.env의 FIREBASE_*(또는 expo.extra)가 비어 있습니다.',
    );
  }
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
    return app;
  }
  app = getApps()[0]!;
  return app;
}

/**
 * Firebase Auth
 * - **Web**: `firebase/auth`의 `getAuth`.
 * - **iOS/Android**: `@firebase/auth` RN 번들의 `initializeAuth` + `getReactNativePersistence(AsyncStorage)`  
 *   (`firebase/auth` 타입 번들에는 RN persistence가 없어 `require('@firebase/auth')`로 로드)
 * - 그 외: `getAuth` 메모리 persistence.
 */
export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  const firebaseApp = getFirebaseApp();
  if (Platform.OS === 'web') {
    auth = getAuth(firebaseApp);
    return auth;
  }
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rnAuth = require('@firebase/auth') as {
      initializeAuth: (app: FirebaseApp, deps: { persistence: unknown }) => Auth;
      getReactNativePersistence: (storage: typeof AsyncStorage) => unknown;
      getAuth: (app: FirebaseApp) => Auth;
    };
    try {
      auth = rnAuth.initializeAuth(firebaseApp, {
        persistence: rnAuth.getReactNativePersistence(AsyncStorage),
      });
      return auth;
    } catch (e) {
      const code =
        typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
      if (code === 'auth/already-initialized') {
        auth = rnAuth.getAuth(firebaseApp);
        return auth;
      }
      throw e;
    }
  }
  auth = getAuth(firebaseApp);
  return auth;
}

/**
 * JS `firebase/auth` 세션이 없을 때 Firestore(`firebase/firestore`)가 규칙상 막히는 경우가 많습니다.
 * Phone Auth는 `@react-native-firebase/auth`를 쓰더라도, 모듈형 Firestore는 여기 `getFirebaseAuth()` 토큰을 따릅니다.
 * 로그아웃 직후 로그인 화면에서의 `users` 조회 등에 쓰며, 실패해도 throw 하지 않습니다.
 */
export async function ensureFirestoreReadAuth(): Promise<void> {
  const a = getFirebaseAuth();
  if (a.currentUser) return;
  try {
    await signInAnonymously(a);
  } catch {
    /* 익명 미허용·오프라인 등 — 호출부에서 조회만 실패할 수 있음 */
  }
}

/** Cloud Firestore */
export function getFirebaseFirestore(): Firestore {
  if (firestore) return firestore;
  const firebaseApp = getFirebaseApp();
  /**
   * WebChannel 스트림(Listen)이 프록시·캐리어·일부 브라우저에서 끊기면
   * `WebChannelConnection RPC 'Listen' transport errored` WARN이 반복될 수 있습니다.
   * - iOS/Android: WebChannel을 쓰지 않고 long polling만 사용(안정·경고 감소).
   * - Web: 자동 감지로 WebChannel 우선, 실패 시 long polling 전환(순수 getFirestore보다 유리).
   */
  const settings =
    Platform.OS === 'web'
      ? { experimentalAutoDetectLongPolling: true as const }
      : { experimentalForceLongPolling: true as const };
  try {
    firestore = initializeFirestore(firebaseApp, settings);
  } catch {
    firestore = getFirestore(firebaseApp);
  }
  return firestore;
}
